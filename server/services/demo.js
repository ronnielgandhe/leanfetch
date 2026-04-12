// Demo mode: realistic mock results based on actual file content analysis.
// Activated when API key is "demo". Runs real GitHub fetch + filtering,
// mocks the Anthropic triage/scan/synthesis phases.

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Simple heuristic triage — check if file actually has LLM patterns
const LLM_PATTERNS = [
  /messages\.create/,
  /chat\.completions\.create/,
  /ChatCompletion/,
  /anthropic|openai/i,
  /langchain|llama.?index/i,
];

export async function demoTriage(files, onProgress) {
  const results = [];
  for (let i = 0; i < files.length; i++) {
    await delay(50); // simulate API latency
    const relevant = LLM_PATTERNS.some((p) => p.test(files[i].content));
    results.push({
      ...files[i],
      relevant,
      triageReason: relevant
        ? 'File contains LLM API call patterns'
        : 'No LLM API patterns detected',
    });
    onProgress({
      file: files[i].path,
      current: i + 1,
      total: files.length,
      usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: i > 0 ? 1000 : 0 },
    });
  }
  return results;
}

// Pattern detectors for demo deep scan
const DETECTORS = [
  {
    pattern: 'n-plus-one',
    test: (content) => {
      // API call inside a loop
      const loopPatterns = [
        /for\s*\(.*\)\s*\{[\s\S]{0,500}messages\.create/,
        /for\s+\w+\s+in\s+[\s\S]{0,500}messages\.create/,
        /\.forEach\([\s\S]{0,500}messages\.create/,
        /\.map\([\s\S]{0,500}(messages\.create|completions\.create)/,
        /for\s*\(.*\)\s*\{[\s\S]{0,500}completions\.create/,
        /for\s+\w+\s+in\s+[\s\S]{0,500}completions\.create/,
        /while\s*\([\s\S]{0,500}(messages\.create|completions\.create)/,
      ];
      return loopPatterns.some((p) => p.test(content));
    },
    build: (file, content) => {
      const lines = content.split('\n');
      let line = 1;
      for (let i = 0; i < lines.length; i++) {
        if (/messages\.create|completions\.create/.test(lines[i])) {
          line = i + 1;
          break;
        }
      }
      const snippet = lines.slice(Math.max(0, line - 3), line + 3).join('\n');
      return {
        pattern: 'n-plus-one',
        severity: 'critical',
        line,
        title: 'N+1 Pattern: LLM API called inside a loop',
        description: 'An API call is made inside a loop, resulting in N separate requests where one batched call could suffice. Each iteration incurs full input/output token costs.',
        codeSnippet: snippet,
        impact: 'Nx cost multiplier where N = number of loop iterations',
        fix: 'Batch items into a single prompt or use the Batch API for parallel processing.',
        savingsRatio: '(N-1)/N per invocation',
      };
    },
  },
  {
    pattern: 'missing-max-tokens',
    test: (content) => {
      // Has API call but no max_tokens
      const hasCall = /messages\.create\s*\(|completions\.create\s*\(/.test(content);
      const hasMaxTokens = /max_tokens|max_completion_tokens/.test(content);
      return hasCall && !hasMaxTokens;
    },
    build: (file, content) => {
      const lines = content.split('\n');
      let line = 1;
      for (let i = 0; i < lines.length; i++) {
        if (/messages\.create|completions\.create/.test(lines[i])) {
          line = i + 1;
          break;
        }
      }
      const snippet = lines.slice(Math.max(0, line - 2), line + 4).join('\n');
      return {
        pattern: 'missing-max-tokens',
        severity: 'warning',
        line,
        title: 'Missing max_tokens parameter',
        description: 'The API call does not specify max_tokens, allowing the model to generate arbitrarily long output. This can lead to unexpectedly high output token costs.',
        codeSnippet: snippet,
        impact: 'Up to 75% wasted output tokens per call if response is longer than needed',
        fix: 'Set max_tokens to a reasonable ceiling for the expected response length.',
        savingsRatio: 'Up to 75% on output tokens per call',
      };
    },
  },
  {
    pattern: 'no-retry',
    test: (content) => {
      const hasCall = /messages\.create|completions\.create/.test(content);
      const hasRetry = /retry|tenacity|backoff|p-retry|maxRetries|max_retries|catch.*retry/i.test(content);
      const hasTryCatch = /try\s*\{[\s\S]*?(messages\.create|completions\.create)[\s\S]*?catch/s.test(content) ||
                          /try:[\s\S]*?(messages\.create|completions\.create)[\s\S]*?except/s.test(content);
      return hasCall && !hasRetry && !hasTryCatch;
    },
    build: (file, content) => {
      const lines = content.split('\n');
      let line = 1;
      for (let i = 0; i < lines.length; i++) {
        if (/messages\.create|completions\.create/.test(lines[i])) {
          line = i + 1;
          break;
        }
      }
      const snippet = lines.slice(Math.max(0, line - 2), line + 2).join('\n');
      return {
        pattern: 'no-retry',
        severity: 'warning',
        line,
        title: 'No retry or error handling around API call',
        description: 'The API call has no try/catch block or retry logic. Transient failures (rate limits, 500 errors, network issues) will crash the process or lose work.',
        codeSnippet: snippet,
        impact: 'Failed calls waste tokens already spent and require manual re-runs',
        fix: 'Add retry with exponential backoff, or configure the SDK\'s built-in retry (e.g., maxRetries option).',
        savingsRatio: 'Prevents wasted tokens on transient failures',
      };
    },
  },
  {
    pattern: 'no-concurrency-limit',
    test: (content) => {
      const hasParallel = /Promise\.all\s*\(|asyncio\.gather|Promise\.allSettled/.test(content);
      const hasApiInParallel = hasParallel && /messages\.create|completions\.create/.test(content);
      const hasLimit = /p-limit|pLimit|Semaphore|concurrency|throttle/i.test(content);
      return hasApiInParallel && !hasLimit;
    },
    build: (file, content) => {
      const lines = content.split('\n');
      let line = 1;
      for (let i = 0; i < lines.length; i++) {
        if (/Promise\.all|asyncio\.gather/.test(lines[i])) {
          line = i + 1;
          break;
        }
      }
      const snippet = lines.slice(Math.max(0, line - 2), line + 3).join('\n');
      return {
        pattern: 'no-concurrency-limit',
        severity: 'warning',
        line,
        title: 'Unbounded parallel API calls',
        description: 'Multiple API calls are fired in parallel without a concurrency limit. This risks hitting rate limits, causing retries and wasted tokens.',
        codeSnippet: snippet,
        impact: 'Rate limit errors cause retries and wasted tokens; bursts can trigger provider throttling',
        fix: 'Use a concurrency limiter like p-limit (JS) or asyncio.Semaphore (Python).',
        savingsRatio: 'Prevents rate-limit-induced retries',
      };
    },
  },
];

export async function demoDeepScan(files, onProgress) {
  const allFlags = [];

  for (let i = 0; i < files.length; i++) {
    await delay(150); // simulate Sonnet latency
    const file = files[i];

    for (const detector of DETECTORS) {
      if (detector.test(file.content)) {
        allFlags.push({ ...detector.build(file, file.content), file: file.path });
      }
    }

    onProgress({
      file: file.path,
      current: i + 1,
      total: files.length,
      usage: { input_tokens: 3500, output_tokens: 800, cache_read_input_tokens: i > 0 ? 2800 : 0 },
    });
  }

  return allFlags;
}

export async function demoSynthesize(flags, onUsage) {
  await delay(300);

  if (onUsage) {
    onUsage({ input_tokens: 4000, output_tokens: 1500 });
  }

  const critical = flags.filter((f) => f.severity === 'critical');
  const warnings = flags.filter((f) => f.severity === 'warning');

  let assessment = `This codebase has ${flags.length} API efficiency issue${flags.length !== 1 ? 's' : ''}.`;
  if (critical.length > 0) {
    assessment += ` ${critical.length} critical pattern${critical.length !== 1 ? 's' : ''} (N+1 API calls) should be addressed immediately for significant cost savings.`;
  }
  if (warnings.length > 0) {
    assessment += ` ${warnings.length} warning${warnings.length !== 1 ? 's' : ''} represent additional optimization opportunities.`;
  }

  const topRec = critical.length > 0
    ? critical[0].fix
    : warnings.length > 0
      ? warnings[0].fix
      : 'No issues found.';

  // Sort: critical first, then warning, then info
  const order = { critical: 0, warning: 1, info: 2 };
  const sorted = [...flags].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));

  return {
    flags: sorted,
    overallAssessment: assessment,
    topRecommendation: topRec,
    estimatedSavings: {
      perInvocationSummary: critical.length > 0
        ? `Fixing the N+1 pattern${critical.length > 1 ? 's' : ''} alone could reduce per-request API calls by up to ${critical.length * 5}x.`
        : 'Applying the suggested fixes could reduce token waste by 20-50% per request.',
      callVolumeNote: 'Enter your monthly call volume to estimate total savings.',
    },
  };
}

// ──── Plan Analysis (demo mode) ────
const PLAN_DETECTORS = [
  {
    pattern: 'planned-n-plus-one',
    test: (text) => /for each\s+(document|item|user|message|chunk|file|record|row)/i.test(text) && /api|llm|model|claude|gpt|call/i.test(text),
    severity: 'critical',
    title: 'Planned per-item LLM processing (N+1 pattern)',
    impact: 'Nx cost multiplier where N is the number of items processed individually',
    fix: 'Batch items into single prompts or use the Batch API instead of per-item calls.',
  },
  {
    pattern: 'unbounded-history',
    test: (text) => /full (conversation |chat )?history|all messages|complete (conversation|context)/i.test(text) && !/truncat|summariz|window|budget/i.test(text),
    severity: 'critical',
    title: 'Unbounded conversation history design',
    impact: 'O(N^2) cumulative token cost — costs grow quadratically with conversation length',
    fix: 'Implement a sliding window (keep last K turns) or summarize older messages.',
  },
  {
    pattern: 'expensive-model-choice',
    test: (text) => /(opus|gpt-4o?|gpt-4-turbo)\b/i.test(text) && /(classif|tag|extract|route|format|yes.no|sentiment)/i.test(text),
    severity: 'warning',
    title: 'Expensive model planned for simple task',
    impact: '3-15x cost premium vs using an appropriate cheaper model',
    fix: 'Use Haiku or GPT-4o-mini for simple tasks like classification, extraction, and routing.',
  },
  {
    pattern: 'missing-caching-strategy',
    test: (text) => /(system prompt|same prompt|repeated|every (request|call|turn))/i.test(text) && !/cach/i.test(text),
    severity: 'warning',
    title: 'No caching strategy mentioned',
    impact: 'Repeated system prompt tokens billed at full price on every call',
    fix: 'Enable Anthropic prompt caching on system prompts and add application-level response caching.',
  },
];

export async function demoPlanAnalyze(planText, planName, onUsage) {
  await delay(200);
  if (onUsage) onUsage({ input_tokens: 3000, output_tokens: 1000 });

  const flags = [];
  const lines = planText.split('\n');

  for (const detector of PLAN_DETECTORS) {
    if (detector.test(planText)) {
      let line = 1;
      for (let i = 0; i < lines.length; i++) {
        if (detector.test(lines[i])) { line = i + 1; break; }
      }
      const snippet = lines.slice(Math.max(0, line - 2), line + 2).join('\n');
      flags.push({
        pattern: detector.pattern,
        severity: detector.severity,
        line,
        title: detector.title,
        description: `The plan describes a pattern that will lead to ${detector.severity === 'critical' ? 'significant' : 'unnecessary'} API costs.`,
        codeSnippet: snippet,
        impact: detector.impact,
        fix: detector.fix,
        savingsRatio: detector.severity === 'critical' ? 'Up to 10x cost reduction' : 'Up to 50% cost reduction',
        file: planName || 'plan.md',
      });
    }
  }

  return flags;
}
