export const LIMITS = {
  tarballBytes: 25 * 1024 * 1024,
  unpackedBytes: 150 * 1024 * 1024,
  maxFiles: 600,
  maxFileBytes: 300 * 1024,
  uploadBytes: 3 * 1024 * 1024,
  uploadFiles: 600,
};

const SOURCE_EXT = /\.(m|c)?(j|t)sx?$|\.py$/;
const SKIP_DIR = /(^|\/)(node_modules|vendor|vendors|third_party|dist|build|out|\.next|\.nuxt|\.output|coverage|__pycache__|\.venv|venv|env|site-packages|\.git|\.cache|target|bower_components|\.turbo|\.vercel|\.svelte-kit|storybook-static|public\/static)\//;
const SKIP_FILE = /(\.min\.(j|c)s$|\.bundle\.js$|\.d\.ts$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock)$|\.map$|-lock\.|\.generated\.|_pb2\.py$)/;
const TEST_FILE = /(^|\/)(__tests__|__mocks__|tests?|spec|fixtures?|e2e|cypress|playwright)\/|\.(test|spec|stories)\.(m|c)?(j|t)sx?$|(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/;

export function isCandidate(path: string): boolean {
  return SOURCE_EXT.test(path) && !SKIP_DIR.test(path) && !SKIP_FILE.test(path);
}

export function isTest(path: string): boolean {
  return TEST_FILE.test(path);
}

export function looksMinified(content: string): boolean {
  const sample = content.slice(0, 20000);
  const lines = sample.split("\n");
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return longest > 3000 || (sample.length > 5000 && sample.length / lines.length > 400);
}

export function priority(path: string, content: string): number {
  let score = 0;
  if (/openai|anthropic|@anthropic-ai|google\.generativeai|google\.genai|@google\/genai|generative-ai|litellm|langchain|llama_index|from\s+["']ai["']|bedrock|cohere|mistral|groq/i.test(content)) score += 10;
  if (/fetch\(|axios|requests\.|httpx|urlopen/.test(content)) score += 3;
  if (/(^|\/)(src|app|lib|server|api|backend|services?|agents?)\//.test(path)) score += 1;
  return score;
}
