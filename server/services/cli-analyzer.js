// CLI-based analyzer: shells out to `claude -p` instead of Anthropic API.
// Uses the user's Max subscription — zero API credits needed.
// Deep scan = Sonnet (fast), Synthesis = Opus (quality).

import { spawn } from 'child_process';
import { TRIAGE_SYSTEM_PROMPT, DEEP_SCAN_SYSTEM_PROMPT, SYNTHESIS_SYSTEM_PROMPT, PLAN_ANALYSIS_PROMPT } from './prompts.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function createLimiter(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (queue.length === 0 || active >= concurrency) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

function claudeRunOnce(prompt, model = 'claude-sonnet-4-6') {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', '--model', model], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    proc.on('error', (err) => reject(new Error(`Failed to run claude CLI: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `claude exited with code ${code}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

async function claudeRun(prompt, model = 'claude-sonnet-4-6', retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await claudeRunOnce(prompt, model);
    } catch (err) {
      console.error(`claude CLI attempt ${attempt + 1} failed:`, err.message?.slice(0, 120));
      if (attempt < retries) {
        const wait = (attempt + 1) * 5000;
        console.log(`Retrying in ${wait / 1000}s...`);
        await delay(wait);
      } else {
        throw err;
      }
    }
  }
}

function parseJsonResponse(text) {
  text = text.trim();
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

// ──── Hybrid Triage (regex instant + Haiku LLM on misses) ────
export async function cliTriage(files, onProgress) {
  const CALL_PATTERNS = [
    /messages\.create\s*\(/,
    /chat\.completions\.create\s*\(/,
    /ChatCompletion\.create\s*\(/,
    /client\.(messages|chat|completions)\.\w+\s*\(/,
    /\.(invoke|ainvoke)\s*\(/,
    /completion\s*=\s*.*\.create\s*\(/,
    /litellm\.(completion|acompletion|text_completion)\s*\(/,
    /Chat(OpenAI|Anthropic|Google|Groq|Ollama)\s*\(/,
    /\.(generate|agenerate)\s*\(/,
    /generate_content\s*\(/,
    /responses\.create\s*\(/,
    /embeddings\.create\s*\(/,          // OpenAI/Anthropic embeddings
    /\.embed\s*\(/,                     // Generic embed calls
    /audio\.transcriptions\.create\s*\(/, // Whisper / speech-to-text
    /images\.(generate|edit)\s*\(/,     // DALL-E / image generation
    // Vercel AI SDK
    /generateText\s*\(/,
    /streamText\s*\(/,
    /generateObject\s*\(/,
    /streamObject\s*\(/,
    // AWS Bedrock
    /invoke_model\s*\(/,
    /\.converse\s*\(/,
    /InvokeModelCommand\s*\(/,
    /ConverseCommand\s*\(/,
    // Cohere
    /co\.(chat|embed|rerank|classify)\s*\(/,
    /cohere\.(Client|ClientV2)\s*\(/,
    // Together / Fireworks / AI21 (OpenAI-compatible)
    /(Together|Fireworks|AI21Client)\s*\(/,
    // Agent frameworks
    /\.kickoff\s*\(/,                   // CrewAI
    /initiate_chat\s*\(/,               // AutoGen v0.2
    /kernel\.invoke_prompt\s*\(/,       // Semantic Kernel
    // Ollama
    /ollama\.(chat|generate)\s*\(/,
  ];

  // Phase 1: Instant regex pass
  const regexHits = [];
  const regexMisses = [];

  for (let i = 0; i < files.length; i++) {
    const hit = CALL_PATTERNS.some((p) => p.test(files[i].content));
    if (hit) {
      regexHits.push({ ...files[i], relevant: true, triageReason: 'Contains direct LLM API calls (regex)' });
    } else {
      regexMisses.push(files[i]);
    }
  }

  onProgress({
    file: '',
    current: regexHits.length,
    total: files.length,
    message: `Regex triage: ${regexHits.length} files matched instantly, ${regexMisses.length} remaining for LLM triage`,
    usage: { input_tokens: 0, output_tokens: 0 },
  });

  // Phase 2: Haiku LLM triage on regex misses (5 concurrent, capped at 200)
  const haikuResults = [];
  const MAX_HAIKU_FILES = 200;

  if (regexMisses.length > 0) {
    // If too many files for Haiku, prioritize by keyword density
    let haikuCandidates = regexMisses;
    if (regexMisses.length > MAX_HAIKU_FILES) {
      haikuCandidates = prioritizeFiles(regexMisses, MAX_HAIKU_FILES);
      // Mark the rest as not relevant (skipped due to volume)
      const skippedPaths = new Set(haikuCandidates.map((f) => f.path));
      for (const file of regexMisses) {
        if (!skippedPaths.has(file.path)) {
          haikuResults.push({ ...file, relevant: false, triageReason: 'Skipped — low keyword density (volume cap)' });
        }
      }
      onProgress({
        file: '',
        current: regexHits.length,
        total: files.length,
        message: `LLM triage: ${regexMisses.length} files → top ${MAX_HAIKU_FILES} by keyword density (${regexMisses.length - MAX_HAIKU_FILES} low-priority skipped)`,
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    }

    const limit = createLimiter(5);
    let haikuCompleted = 0;

    await Promise.all(haikuCandidates.map((file) => limit(async () => {
      try {
        const prompt = `${TRIAGE_SYSTEM_PROMPT}\n\nAnalyze this file and determine if it contains LLM/AI API patterns worth auditing.\n\nFile: ${file.path}\n\n\`\`\`\n${file.content.slice(0, 30_000)}\n\`\`\``;

        const output = await claudeRun(prompt, 'claude-haiku-4-5-20251001', 1);
        const parsed = parseJsonResponse(output);

        haikuCompleted++;
        haikuResults.push({
          ...file,
          relevant: parsed.relevant === true,
          triageReason: parsed.reason || (parsed.relevant ? 'LLM triage: relevant' : 'LLM triage: not relevant'),
        });

        onProgress({
          file: file.path,
          current: regexHits.length + haikuCompleted,
          total: files.length,
          message: `LLM triage: ${file.path} — ${parsed.relevant ? 'relevant' : 'skipped'}`,
          usage: { input_tokens: 0, output_tokens: 0 },
        });
      } catch (err) {
        haikuCompleted++;
        // On error, include file (false negatives are worse than false positives)
        haikuResults.push({
          ...file,
          relevant: true,
          triageReason: `LLM triage error, including as safety fallback: ${err.message?.slice(0, 80)}`,
        });
        onProgress({
          file: file.path,
          current: regexHits.length + haikuCompleted,
          total: files.length,
          message: `LLM triage: ${file.path} — error, including as fallback`,
          usage: { input_tokens: 0, output_tokens: 0 },
        });
      }
    })));
  }

  const haikuHits = haikuResults.filter((f) => f.relevant);
  const allResults = [...regexHits, ...haikuResults];

  onProgress({
    file: '',
    current: files.length,
    total: files.length,
    message: `Triage complete: ${regexHits.length} from regex + ${haikuHits.length} from LLM = ${regexHits.length + haikuHits.length} files for deep scan`,
    usage: { input_tokens: 0, output_tokens: 0 },
  });

  return allResults;
}

// ──── Smart File Prioritization (top 20 by keyword density) ────
function prioritizeFiles(files, maxFiles = 20) {
  if (files.length <= maxFiles) return files;

  const PRIORITY_PATTERNS = [
    { pattern: /messages\.create|chat\.completions\.create|generateText|invoke_model|\.converse\(/g, weight: 10 },
    { pattern: /cache_control|prompt.cach/ig, weight: 8 },
    { pattern: /\.invoke\(|\.ainvoke\(|\.kickoff\(|initiate_chat\(/g, weight: 6 },
    { pattern: /embeddings\.create|\.embed\(|co\.embed\(/g, weight: 5 },
    { pattern: /max_tokens|max_output_tokens|maxTokens/g, weight: 3 },
    { pattern: /retry|backoff|tenacity|maxRetries|max_retries/ig, weight: 2 },
    { pattern: /streamText|streamObject|\.stream\(/g, weight: 2 },
  ];

  const scored = files.map((file) => {
    let score = 0;
    for (const { pattern, weight } of PRIORITY_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = (file.content.match(pattern) || []).length;
      score += matches * weight;
    }
    return { ...file, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);
  console.log(`File prioritization: ${files.length} triaged files → top ${maxFiles} by keyword density (scores: ${scored.slice(0, 5).map((f) => `${f.path.split('/').pop()}=${f._score}`).join(', ')}...)`);
  return scored.slice(0, maxFiles);
}

// ──── File Chunking (split large files for better deep scan) ────
function chunkFile(file) {
  const lines = file.content.split('\n');
  if (lines.length <= 500) return [file]; // small file, no chunking

  const HEADER_LINES = 40;
  const CHUNK_SIZE = 500;
  const header = lines.slice(0, HEADER_LINES).join('\n');
  const body = lines.slice(HEADER_LINES);
  const totalChunks = Math.ceil(body.length / CHUNK_SIZE);
  const chunks = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunkLines = body.slice(start, start + CHUNK_SIZE);
    const lineOffset = HEADER_LINES + start + 1; // 1-indexed line number where this chunk starts
    chunks.push({
      ...file,
      path: `${file.path} (chunk ${i + 1}/${totalChunks}, lines ${lineOffset}-${lineOffset + chunkLines.length - 1})`,
      content: header + `\n\n# ... (lines ${HEADER_LINES + 1}-${lineOffset - 1} omitted for context) ...\n\n` + chunkLines.join('\n'),
      originalPath: file.path,
      lineOffset,
    });
  }

  return chunks;
}

// ──── Cross-file context builder (for N+1 detection across layers) ────
function buildCrossFileContext(files) {
  const FN_PATTERNS = [
    /(?:def|async def)\s+(\w+)\s*\(/g,               // Python
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,   // JS/TS
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g, // JS arrow
    /func\s+(\w+)\s*\(/g,                              // Go
    /(?:public|private|protected)?\s+\w+\s+(\w+)\s*\(/g, // Java/C#
  ];

  const fileExports = {};
  for (const file of files) {
    if (!file.content) continue;
    const fns = new Set();
    for (const pattern of FN_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(file.content)) !== null) {
        if (match[1] && match[1].length > 2) fns.add(match[1]);
      }
    }
    if (fns.size > 0) {
      fileExports[file.originalPath || file.path] = Array.from(fns).slice(0, 20); // cap at 20 per file
    }
  }
  return fileExports;
}

function formatCrossFileContext(fileExports, currentFile) {
  const entries = Object.entries(fileExports)
    .filter(([path]) => path !== currentFile)
    .map(([path, fns]) => `  ${path}: ${fns.join(', ')}`)
    .slice(0, 15); // cap context size

  if (entries.length === 0) return '';
  return `\n\nCross-file context — these other files in this repo also contain LLM API call patterns:\n${entries.join('\n')}\nIf this file calls any of these functions inside a loop, that constitutes an N+1 pattern.`;
}

// ──── Deep Scan (Sonnet via CLI — 3 files in parallel, with chunking + cross-file context) ────
export async function cliDeepScan(files, onProgress) {
  // Prioritize files by keyword density (top 20)
  const prioritized = prioritizeFiles(files, 20);

  // Build cross-file context for N+1 detection (use ALL files, not just prioritized)
  const crossFileContext = buildCrossFileContext(files);

  // Expand large files into chunks, cap total at 30 units
  let expandedFiles = prioritized.flatMap((f) => chunkFile(f));
  if (expandedFiles.length > 30) {
    console.log(`Chunk cap: ${expandedFiles.length} chunks → capped at 30`);
    expandedFiles = expandedFiles.slice(0, 30);
  }
  const chunkedCount = expandedFiles.length - prioritized.length;
  if (chunkedCount > 0) {
    console.log(`Chunking: ${prioritized.length} files expanded to ${expandedFiles.length} chunks`);
  }

  const allFlags = [];
  const scanStart = Date.now();
  const limit = createLimiter(3);
  let completed = 0;
  const totalUnits = expandedFiles.length;

  await Promise.all(expandedFiles.map((file) => limit(async () => {
    const fileStart = Date.now();
    const displayPath = file.path;
    const filePath = file.originalPath || file.path;

    onProgress({
      file: displayPath,
      current: completed + 1,
      total: totalUnits,
      message: `Analyzing ${displayPath} with Sonnet...`,
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    try {
      const context = formatCrossFileContext(crossFileContext, filePath);
      const prompt = `${DEEP_SCAN_SYSTEM_PROMPT}\n\n---\n\nAnalyze this file for API inefficiency patterns.\n\nFile: ${filePath}\n\n\`\`\`\n${file.content}\n\`\`\`${context}`;

      const output = await claudeRun(prompt, 'claude-sonnet-4-6');
      const parsed = parseJsonResponse(output);
      const elapsed = ((Date.now() - fileStart) / 1000).toFixed(1);

      if (parsed.flags && Array.isArray(parsed.flags)) {
        for (const flag of parsed.flags) {
          // Attribute flags to the original file path, adjust line numbers for chunks
          const flagFile = file.originalPath || file.path;
          const adjustedLine = file.lineOffset ? (flag.line + file.lineOffset - 1) : flag.line;
          allFlags.push({ ...flag, file: flagFile, line: adjustedLine });
        }
        completed++;
        onProgress({
          file: displayPath,
          current: completed,
          total: totalUnits,
          message: `${displayPath} — ${parsed.flags.length} flag${parsed.flags.length !== 1 ? 's' : ''} found (${elapsed}s)`,
          usage: { input_tokens: 0, output_tokens: 0 },
        });
      } else {
        completed++;
        onProgress({
          file: displayPath,
          current: completed,
          total: totalUnits,
          message: `${displayPath} — clean (${elapsed}s)`,
          usage: { input_tokens: 0, output_tokens: 0 },
        });
      }
    } catch (err) {
      const elapsed = ((Date.now() - fileStart) / 1000).toFixed(1);
      console.error(`CLI deep scan error for ${displayPath}:`, err.message?.slice(0, 120));
      completed++;
      onProgress({
        file: displayPath,
        current: completed,
        total: totalUnits,
        message: `${displayPath} — error, skipping (${elapsed}s)`,
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    }
  })));

  // Deduplicate flags from chunks of the same file (keep most specific per pattern)
  const deduped = deduplicateChunkFlags(allFlags);

  const totalElapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
  console.log(`Deep scan complete: ${deduped.length} flags in ${totalElapsed}s`);
  return deduped;
}

function deduplicateChunkFlags(flags) {
  // Group by file + pattern, keep the flag with the most specific (non-zero) line number
  const seen = new Map();
  for (const flag of flags) {
    const key = `${flag.file}::${flag.pattern}`;
    const existing = seen.get(key);
    if (!existing || (flag.line && (!existing.line || flag.description.length > existing.description.length))) {
      seen.set(key, flag);
    }
  }
  return Array.from(seen.values());
}

// ──── Synthesis (Opus via CLI — one call, max quality) ────
export async function cliSynthesize(flags, onUsage) {
  if (onUsage) onUsage({ input_tokens: 0, output_tokens: 0 });

  const flagsSummary = flags.map((f) => ({
    file: f.file, line: f.line, pattern: f.pattern, severity: f.severity,
    title: f.title, description: f.description, codeSnippet: f.codeSnippet,
    impact: f.impact, fix: f.fix, savingsRatio: f.savingsRatio,
  }));

  try {
    const prompt = `${SYNTHESIS_SYSTEM_PROMPT}\n\n---\n\nHere are all the efficiency flags found across the codebase. Produce a prioritized synthesis report.\n\nFlags:\n${JSON.stringify(flagsSummary, null, 2)}`;

    const output = await claudeRun(prompt, 'claude-opus-4-6');
    return parseJsonResponse(output);
  } catch (err) {
    return {
      flags,
      overallAssessment: `Synthesis failed: ${err.message}. Showing raw flags.`,
      topRecommendation: flags[0]?.fix || 'Review the flags below.',
      estimatedSavings: { perInvocationSummary: 'Unable to calculate.', callVolumeNote: '' },
    };
  }
}

// ──── Plan Analysis (Sonnet via CLI) ────
export async function cliPlanAnalyze(planText, planName, onUsage) {
  if (onUsage) onUsage({ input_tokens: 0, output_tokens: 0 });

  try {
    const prompt = `${PLAN_ANALYSIS_PROMPT}\n\n---\n\nAnalyze this architecture/design document for LLM API cost inefficiency patterns.\n\nDocument: ${planName || 'plan.md'}\n\n${planText}`;

    const output = await claudeRun(prompt, 'claude-sonnet-4-6');
    const parsed = parseJsonResponse(output);
    return parsed.flags || [];
  } catch (err) {
    console.error('CLI plan analysis error:', err.message?.slice(0, 120));
    throw err;
  }
}
