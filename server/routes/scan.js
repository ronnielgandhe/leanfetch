import { Router } from 'express';
import { cloneAndReadRepo, readFileContents, cleanupClone } from '../services/github.js';
import { structuralFilter, subpathFilter, keywordFilter } from '../services/filter.js';
import { triage, deepScan, synthesize, planAnalyze } from '../services/analyzer.js';
import { extractText } from '../services/document.js';

const router = Router();

router.post('/', async (req, res) => {
  const { sourceType, anthropicKey } = req.body;

  if (!anthropicKey) {
    return res.status(400).json({ error: 'Anthropic API key is required' });
  }

  // Validate based on sourceType
  if (sourceType === 'github') {
    if (!req.body.url) return res.status(400).json({ error: 'GitHub URL is required' });
  } else if (sourceType === 'files') {
    if (!req.body.files || !Array.isArray(req.body.files) || req.body.files.length === 0) {
      return res.status(400).json({ error: 'At least one file is required' });
    }
  } else if (sourceType === 'plan') {
    if ((!req.body.planText || !req.body.planText.trim()) && !req.body.planFile) {
      return res.status(400).json({ error: 'Plan text or file is required' });
    }
  } else {
    return res.status(400).json({ error: 'Invalid sourceType. Use: github, files, or plan' });
  }

  // NDJSON streaming response
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event) => res.write(JSON.stringify(event) + '\n');

  const tokenUsage = {
    triage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    deepScan: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    synthesis: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  };

  try {
    if (sourceType === 'github') {
      await handleGithubScan(req.body, send, tokenUsage);
    } else if (sourceType === 'files') {
      await handleFileScan(req.body, send, tokenUsage);
    } else if (sourceType === 'plan') {
      await handlePlanAnalysis(req.body, send, tokenUsage);
    }
  } catch (err) {
    send({ type: 'error', message: err.message || 'An unexpected error occurred' });
  } finally {
    res.end();
  }
});

// ──── GitHub Repo Scan (existing pipeline) ────
async function handleGithubScan({ url, anthropicKey, githubPat, subpath }, send, tokenUsage) {
  let tmpDir = null;

  try {
    const parsed = parseGitHubUrl(url);

    send({ type: 'progress', phase: 'fetch', message: `Cloning ${parsed.owner}/${parsed.repo}...` });
    const clone = await cloneAndReadRepo(parsed.owner, parsed.repo, parsed.branch, githubPat);
    tmpDir = clone.tmpDir;
    send({ type: 'progress', phase: 'fetch', message: `Cloned repository (${clone.files.length} files)`, done: true });

    const scopedFiles = subpathFilter(clone.files, subpath);
    send({ type: 'progress', phase: 'structural', message: `Applying structural filters${subpath ? ` (scoped to ${subpath})` : ''}...` });
    const afterStructural = structuralFilter(scopedFiles);
    send({ type: 'progress', phase: 'structural', message: `Structural filter (${afterStructural.length} files remain)`, done: true });

    if (afterStructural.length === 0) return finish(send, tokenUsage, clone.files.length, 0);

    send({ type: 'progress', phase: 'content', message: `Reading ${afterStructural.length} files from disk...` });
    const filesWithContent = readFileContents(afterStructural, (p) => {
      if (p.current % 20 === 0 || p.current === p.total) {
        send({ type: 'progress', phase: 'content', message: `Read ${p.current}/${p.total} files`, current: p.current, total: p.total });
      }
    });
    send({ type: 'progress', phase: 'content', message: `Read ${filesWithContent.length} file contents`, done: true });

    await runCodePipeline(filesWithContent, anthropicKey, send, tokenUsage, clone.files.length);
  } finally {
    if (tmpDir) cleanupClone(tmpDir);
  }
}

// ──── File Upload Scan (skip clone, same pipeline) ────
async function handleFileScan({ files, anthropicKey }, send, tokenUsage) {
  send({ type: 'progress', phase: 'fetch', message: `Received ${files.length} uploaded file${files.length !== 1 ? 's' : ''}`, done: true });

  // Build file objects from uploaded data
  const fileObjects = files.map((f) => ({
    path: f.name,
    content: f.content,
    size: f.content.length,
  }));

  send({ type: 'progress', phase: 'structural', message: 'Applying structural filters...' });
  const afterStructural = structuralFilter(fileObjects);
  send({ type: 'progress', phase: 'structural', message: `Structural filter (${afterStructural.length} files remain)`, done: true });

  if (afterStructural.length === 0) return finish(send, tokenUsage, files.length, 0);

  await runCodePipeline(afterStructural, anthropicKey, send, tokenUsage, files.length);
}

// ──── Shared code scanning pipeline (keyword → triage → deep scan → synthesis) ────
async function runCodePipeline(filesWithContent, anthropicKey, send, tokenUsage, totalFilesScanned) {
  send({ type: 'progress', phase: 'keyword', message: 'Scanning for API keywords...' });
  const afterKeyword = keywordFilter(filesWithContent);
  send({ type: 'progress', phase: 'keyword', message: `Keyword filter (${afterKeyword.length} files remain)`, done: true });

  if (afterKeyword.length === 0) return finish(send, tokenUsage, totalFilesScanned, 0);

  send({ type: 'progress', phase: 'triage', message: `Starting triage on ${afterKeyword.length} files...`, current: 0, total: afterKeyword.length });
  const triaged = await triage(afterKeyword, anthropicKey, (p) => {
    send({ type: 'progress', phase: 'triage', message: `Triage: analyzing ${p.file}...`, current: p.current, total: p.total });
    if (p.usage) addUsage(tokenUsage.triage, p.usage);
  });
  const relevant = triaged.filter((f) => f.relevant);
  send({ type: 'progress', phase: 'triage', message: `Triage complete (${relevant.length} files flagged for deep scan)`, done: true });

  if (relevant.length === 0) return finish(send, tokenUsage, totalFilesScanned, 0);

  send({ type: 'progress', phase: 'deepScan', message: `Starting deep scan on ${relevant.length} files...`, current: 0, total: relevant.length });
  const allFlags = await deepScan(relevant, anthropicKey, (p) => {
    const msg = p.message || `Deep scan: analyzing ${p.file}...`;
    send({ type: 'progress', phase: 'deepScan', message: msg, current: p.current, total: p.total });
    if (p.usage) addUsage(tokenUsage.deepScan, p.usage);
  });
  send({ type: 'progress', phase: 'deepScan', message: `Deep scan complete (${allFlags.length} flags found)`, done: true });

  if (allFlags.length === 0) return finish(send, tokenUsage, totalFilesScanned, relevant.length);

  send({ type: 'progress', phase: 'synthesis', message: 'Generating synthesis report...' });
  const report = await synthesize(allFlags, anthropicKey, (usage) => {
    addUsage(tokenUsage.synthesis, usage);
  });
  send({ type: 'progress', phase: 'synthesis', message: 'Synthesis complete', done: true });

  const summary = {
    filesScanned: totalFilesScanned,
    filesAnalyzed: relevant.length,
    totalFlags: report.flags.length,
    critical: report.flags.filter((f) => f.severity === 'critical').length,
    warning: report.flags.filter((f) => f.severity === 'warning').length,
    info: report.flags.filter((f) => f.severity === 'info').length,
  };

  send({ type: 'complete', report: { ...report, summary, tokenUsage } });
}

// ──── Plan Analysis (custom pipeline) ────
async function handlePlanAnalysis({ planText, planFile, planName, anthropicKey }, send, tokenUsage) {
  const name = planName || 'plan.md';
  let text = planText || '';

  // If a file was uploaded (base64), extract text from it
  if (planFile) {
    send({ type: 'progress', phase: 'parse', message: `Extracting text from ${name}...` });
    try {
      text = await extractText(planFile, name);
    } catch (err) {
      send({ type: 'error', message: `Failed to extract text from ${name}: ${err.message}` });
      return;
    }
  }

  if (!text.trim()) {
    send({ type: 'error', message: 'No text could be extracted from the uploaded document.' });
    return;
  }

  send({ type: 'progress', phase: 'parse', message: `Parsed plan: ${name} (${text.length} characters)`, done: true });

  send({ type: 'progress', phase: 'analysis', message: 'Analyzing plan for cost inefficiency patterns...' });
  const flags = await planAnalyze(planText, name, anthropicKey, (usage) => {
    addUsage(tokenUsage.deepScan, usage); // normalize into deepScan bucket for client compat
  });
  send({ type: 'progress', phase: 'analysis', message: `Analysis complete (${flags.length} flags found)`, done: true });

  if (flags.length === 0) {
    return finish(send, tokenUsage, 1, 1, 'No cost inefficiency patterns were found in this plan.');
  }

  send({ type: 'progress', phase: 'synthesis', message: 'Generating synthesis report...' });
  const report = await synthesize(flags, anthropicKey, (usage) => {
    addUsage(tokenUsage.synthesis, usage);
  });
  send({ type: 'progress', phase: 'synthesis', message: 'Synthesis complete', done: true });

  const summary = {
    filesScanned: 1,
    filesAnalyzed: 1,
    totalFlags: report.flags.length,
    critical: report.flags.filter((f) => f.severity === 'critical').length,
    warning: report.flags.filter((f) => f.severity === 'warning').length,
    info: report.flags.filter((f) => f.severity === 'info').length,
  };

  send({ type: 'complete', report: { ...report, summary, tokenUsage } });
}

// ──── Utilities ────

function finish(send, tokenUsage, filesScanned, filesAnalyzed, message) {
  send({
    type: 'complete',
    report: {
      flags: [],
      overallAssessment: message || 'No API inefficiency patterns were found.',
      summary: { filesScanned, filesAnalyzed, totalFlags: 0, critical: 0, warning: 0, info: 0 },
      tokenUsage,
    },
  });
}

function addUsage(target, usage) {
  target.input += usage.input_tokens || 0;
  target.output += usage.output_tokens || 0;
  target.cacheRead += usage.cache_read_input_tokens || 0;
  target.cacheCreation += usage.cache_creation_input_tokens || 0;
}

function parseGitHubUrl(url) {
  url = url.trim().replace(/\/$/, '');

  let match = url.match(/(?:https?:\/\/)?github\.com\/([^/]+)\/([^/.#]+?)(?:\.git)?(?:\/tree\/([^/]+))?(?:\/.*)?$/);
  if (match) {
    return { owner: match[1], repo: match[2], branch: match[3] || null };
  }

  match = url.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (match) {
    return { owner: match[1], repo: match[2], branch: null };
  }

  throw new Error('Invalid GitHub URL. Use: https://github.com/owner/repo or owner/repo');
}

export { router as scanRouter };
