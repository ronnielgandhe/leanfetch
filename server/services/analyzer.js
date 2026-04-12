import Anthropic from '@anthropic-ai/sdk';
import { TRIAGE_SYSTEM_PROMPT, DEEP_SCAN_SYSTEM_PROMPT, SYNTHESIS_SYSTEM_PROMPT, PLAN_ANALYSIS_PROMPT } from './prompts.js';
import { demoTriage, demoDeepScan, demoSynthesize, demoPlanAnalyze } from './demo.js';
import { cliTriage, cliDeepScan, cliSynthesize, cliPlanAnalyze } from './cli-analyzer.js';

const DEMO_KEY = 'demo';
const CLI_KEY = 'cli';

function parseJsonResponse(text) {
  text = text.trim();
  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) text = fenced[1].trim();
  return JSON.parse(text);
}

// ──── Triage (Haiku) ────────────────────────────────────
export async function triage(files, apiKey, onProgress) {
  if (apiKey === DEMO_KEY) return demoTriage(files, onProgress);
  if (apiKey === CLI_KEY) return cliTriage(files, onProgress);
  const client = new Anthropic({ apiKey });
  const results = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const response = await client.messages.create({
        model: 'claude-opus-4-6-20250514',
        max_tokens: 512,
        system: [
          { type: 'text', text: TRIAGE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          {
            role: 'user',
            content: `Analyze this file and determine if it contains LLM/AI API patterns worth auditing.\n\nFile: ${file.path}\n\n\`\`\`\n${file.content}\n\`\`\``,
          },
        ],
      });

      const text = response.content[0]?.text || '';
      const parsed = parseJsonResponse(text);
      results.push({ ...file, relevant: parsed.relevant === true, triageReason: parsed.reason });

      onProgress({
        file: file.path,
        current: i + 1,
        total: files.length,
        usage: response.usage,
      });
    } catch (err) {
      // Fail fast on auth errors — no point trying remaining files
      if (err.status === 401 || err.message?.includes('authentication_error')) {
        throw new Error('Invalid Anthropic API key. Please check your key and try again.');
      }
      // On other errors, include the file (false negatives are worse)
      results.push({ ...file, relevant: true, triageReason: `Triage error: ${err.message}` });
      onProgress({ file: file.path, current: i + 1, total: files.length });
    }
  }

  return results;
}

// ──── Deep Scan (Sonnet) ────────────────────────────────
export async function deepScan(files, apiKey, onProgress) {
  if (apiKey === DEMO_KEY) return demoDeepScan(files, onProgress);
  if (apiKey === CLI_KEY) return cliDeepScan(files, onProgress);
  const client = new Anthropic({ apiKey });
  const allFlags = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const response = await client.messages.create({
        model: 'claude-opus-4-6-20250514',
        max_tokens: 4096,
        system: [
          { type: 'text', text: DEEP_SCAN_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          {
            role: 'user',
            content: `Analyze this file for API inefficiency patterns.\n\nFile: ${file.path}\n\n\`\`\`\n${file.content}\n\`\`\``,
          },
        ],
      });

      const text = response.content[0]?.text || '';
      const parsed = parseJsonResponse(text);

      if (parsed.flags && Array.isArray(parsed.flags)) {
        for (const flag of parsed.flags) {
          allFlags.push({ ...flag, file: file.path });
        }
      }

      onProgress({
        file: file.path,
        current: i + 1,
        total: files.length,
        usage: response.usage,
      });
    } catch (err) {
      if (err.status === 401 || err.message?.includes('authentication_error')) {
        throw new Error('Invalid Anthropic API key. Please check your key and try again.');
      }
      // Log and continue — don't let one file break the scan
      console.error(`Deep scan error for ${file.path}:`, err.message);
      onProgress({ file: file.path, current: i + 1, total: files.length });
    }
  }

  return allFlags;
}

// ──── Synthesis (Sonnet) ─────────────────────────────────
export async function synthesize(flags, apiKey, onUsage) {
  if (apiKey === DEMO_KEY) return demoSynthesize(flags, onUsage);
  if (apiKey === CLI_KEY) return cliSynthesize(flags, onUsage);
  const client = new Anthropic({ apiKey });

  const flagsSummary = flags.map((f) => ({
    file: f.file,
    line: f.line,
    pattern: f.pattern,
    severity: f.severity,
    title: f.title,
    description: f.description,
    codeSnippet: f.codeSnippet,
    impact: f.impact,
    fix: f.fix,
    savingsRatio: f.savingsRatio,
  }));

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6-20250514',
      max_tokens: 4096,
      system: [{ type: 'text', text: SYNTHESIS_SYSTEM_PROMPT }],
      messages: [
        {
          role: 'user',
          content: `Here are all the efficiency flags found across the codebase. Produce a prioritized synthesis report.\n\nFlags:\n${JSON.stringify(flagsSummary, null, 2)}`,
        },
      ],
    });

    if (onUsage) onUsage(response.usage);

    const text = response.content[0]?.text || '';
    return parseJsonResponse(text);
  } catch (err) {
    // Return raw flags if synthesis fails
    return {
      flags,
      overallAssessment: `Synthesis failed: ${err.message}. Showing raw flags.`,
      topRecommendation: flags[0]?.fix || 'Review the flags below.',
      estimatedSavings: {
        perInvocationSummary: 'Unable to calculate — synthesis error.',
        callVolumeNote: '',
      },
    };
  }
}

// ──── Plan Analysis ─────────────────────────────────────────
export async function planAnalyze(planText, planName, apiKey, onUsage) {
  if (apiKey === DEMO_KEY) return demoPlanAnalyze(planText, planName, onUsage);
  if (apiKey === CLI_KEY) return cliPlanAnalyze(planText, planName, onUsage);
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6-20250514',
      max_tokens: 8192,
      system: [
        { type: 'text', text: PLAN_ANALYSIS_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: `Analyze this architecture/design document for LLM API cost inefficiency patterns.\n\nDocument: ${planName || 'plan.md'}\n\n${planText}`,
        },
      ],
    });

    if (onUsage) onUsage(response.usage);
    const text = response.content[0]?.text || '';
    const parsed = parseJsonResponse(text);
    return parsed.flags || [];
  } catch (err) {
    if (err.status === 401 || err.message?.includes('authentication_error')) {
      throw new Error('Invalid Anthropic API key. Please check your key and try again.');
    }
    throw err;
  }
}
