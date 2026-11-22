import { CHEAP_ALTERNATIVE, findPrice, providerOfModel, tierOf } from "../pricing";
import type { CallKind, Finding, Level, PatternId, Provider, ScanStats, SnippetLine, SourceFile } from "../types";
import { lineOf, matchClose, parse, stringText, type Parsed } from "./source";
import {
  enclosing,
  findFunctions,
  findLoops,
  findSites,
  findStringConsts,
  importsName,
  innermost,
  type Fn,
  type Loop,
  type Site,
  type StrConst,
} from "./structure";

interface Ctx {
  p: Parsed;
  loops: Loop[];
  fns: Fn[];
  consts: Map<string, StrConst>;
  llm: Site[];
  http: Site[];
  models: Map<Site, string | undefined>;
  offline: boolean;
  local: boolean;
  cachePrims: boolean;
  usesBatch: boolean;
}

interface Wrapper {
  name: string;
  ctx: Ctx;
  fn: Fn;
  site: Site;
  siteCtx: Ctx;
  depth: number;
}

interface Invocation {
  ctx: Ctx;
  start: number;
  end: number;
  line: number;
  endLine: number;
  site: Site;
  siteCtx: Ctx;
  wrapper?: Wrapper;
  resolution: "direct" | "local" | "import" | "method";
  label: string;
}

export interface AnalysisResult {
  findings: Finding[];
  stats: Omit<ScanStats, "filesInSource" | "filesSkipped" | "capped">;
  models: string[];
  providers: Provider[];
  errors: string[];
}

const MAX_KEY = /\b(max_tokens|max_completion_tokens|max_output_tokens|maxTokens|maxOutputTokens|maxCompletionTokens|max_new_tokens|maxNewTokens|num_predict)\b/;
const CACHE_PRIMS = /lru_cache|@cache\b|functools\.cache|@cached|memoize|useMemo|unstable_cache|["']use cache["']|cache\.(get|set)\(|redis|lru-cache|node-cache|keyv|diskcache|joblib\.Memory|requests_cache|cachetools/i;
const OFFLINE_PATH = /(^|\/)(scripts?|cron|jobs?|tasks?|workers?|batch|backfills?|etl|pipelines?|seeds?|migrations?|evals?|benchmarks?|notebooks?|offline|nightly|ingest(ion)?)(\/|\.|_|-)/i;
const OFFLINE_CODE = /if\s+__name__\s*==\s*["']__main__["']|node-cron|cron\.schedule|schedule\.every|@celery|celery\.task|@shared_task|@app\.task|APScheduler|BlockingScheduler|@scheduler|import\s+argparse|process\.argv/;
const BATCH_USE = /batches\.create|\/v1\/batches|batch_create|create_batch|messages\.batches|client\.batches|BatchJob|batch_predict|batchEmbedContents|embed_documents|embedMany/;
const LOCAL_HINT = /localhost:11434|127\.0\.0\.1:11434|\bollama\b|lmstudio|localhost:1234|llama\.cpp|vllm|\blocalai\b/i;
const AGENT_HINT = /tool_calls|tool_use|tool_result|function_call|stop_reason|finish_reason/;
const GENERIC_NAMES = new Set([
  "run", "main", "call", "create", "get", "post", "put", "send", "handle", "handler", "invoke", "execute", "process",
  "request", "fetch", "query", "init", "start", "render", "default", "constructor", "__init__", "__call__", "update",
  "save", "load", "parse", "build", "make", "apply", "next", "then", "wrapper", "inner", "test", "setup", "close", "open",
  "read", "write", "stream", "log", "print", "format", "map", "filter", "reduce", "list", "delete", "remove", "add",
]);
const MODEL_LIT = /["'`]((?:gpt-[\w.-]+|o[134](?:-mini|-pro)?|claude-[\w.-]+|gemini-[\w.-]+|text-embedding-[\w.-]+|chatgpt-[\w.-]+|(?:anthropic|openai|google)\/[\w.-]+))["'`]/g;

export function analyze(files: SourceFile[]): AnalysisResult {
  const ctxs: Ctx[] = [];
  const errors: string[] = [];
  const repoConsts = new Map<string, StrConst>();
  for (const f of files) {
    const p = safe(errors, f.path, () => parse(f.path, f.content));
    if (!p) continue;
    const consts = safe(errors, f.path, () => findStringConsts(p));
    if (!consts) continue;
    for (const [k, v] of consts) if (!repoConsts.has(k) || v.value.length > (repoConsts.get(k)?.value.length ?? 0)) repoConsts.set(k, v);
    ctxs.push({
      p,
      loops: safe(errors, f.path, () => findLoops(p)) ?? [],
      fns: safe(errors, f.path, () => findFunctions(p)) ?? [],
      consts,
      llm: [],
      http: [],
      models: new Map(),
      offline: OFFLINE_PATH.test(p.path) || OFFLINE_CODE.test(p.code),
      local: LOCAL_HINT.test(p.code),
      cachePrims: CACHE_PRIMS.test(p.code),
      usesBatch: BATCH_USE.test(p.code),
    });
  }
  for (const c of ctxs) {
    const found = safe(errors, c.p.path, () => findSites(c.p, mergedConsts(c.consts, repoConsts)));
    if (!found) continue;
    const { llm, http } = found;
    c.llm = llm;
    c.http = http;
    for (const s of llm) {
      const model = resolveModel(c, s, repoConsts);
      c.models.set(s, model);
      if (model) {
        const mp = providerOfModel(model);
        if (mp !== "unknown") s.provider = mp;
      }
      if (c.local && (!model || providerOfModel(model) === "other" || providerOfModel(model) === "unknown")) s.provider = "local";
    }
  }

  const wrappers = buildWrappers(ctxs);
  const repoZeroRetries = ctxs.some((c) => /max_retries\s*[=:]\s*0\b|maxRetries\s*:\s*0\b/.test(c.p.code));

  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding | null) => {
    if (!f) return;
    const key = `${f.pattern}|${f.file}|${f.startLine}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };

  for (const c of ctxs) {
    const invs = safe(errors, c.p.path, () => invocations(c, wrappers)) ?? [];
    const steps: [string, () => void][] = [
      ["loops", () => detectLoops(c, invs, add)],
      ["max-tokens", () => detectMaxTokens(c, add)],
      ["retries", () => detectRetries(c, invs, repoZeroRetries, add)],
      ["model", () => detectExpensiveModel(c, repoConsts, add)],
      ["caching", () => detectCaching(c, repoConsts, add)],
      ["history", () => detectHistory(c, add)],
      ["context", () => detectOversized(c, invs, add)],
      ["static", () => detectStaticCalls(c, invs, repoConsts, add)],
      ["duplicates", () => detectDuplicateInvocations(c, invs, add)],
      ["polling", () => detectPolling(c, invs, add)],
      ["fetch", () => detectDuplicateFetch(c, invs, add)],
    ];
    for (const [name, run] of steps) safe(errors, `${c.p.path} (${name})`, run);
  }

  const models = new Set<string>();
  const providers = new Set<Provider>();
  let llmSites = 0;
  let httpSites = 0;
  let bytes = 0;
  for (const c of ctxs) {
    bytes += c.p.raw.length;
    httpSites += c.http.length;
    for (const s of c.llm) {
      if (s.provider === "local") continue;
      llmSites++;
      providers.add(s.provider);
      const m = c.models.get(s);
      if (m) models.add(m);
    }
  }
  const order: Record<Level, number> = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.severity] - order[b.severity] || order[a.confidence] - order[b.confidence] || a.file.localeCompare(b.file) || a.startLine - b.startLine);
  return {
    findings: out,
    stats: { filesScanned: ctxs.length, llmCallSites: llmSites, httpCallSites: httpSites, wrappers: wrappers.length, bytesScanned: bytes },
    models: [...models].sort(),
    providers: [...providers],
    errors,
  };
}

function safe<T>(errors: string[], label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    errors.push(`could not analyze ${label}`);
    return undefined;
  }
}

function mergedConsts(local: Map<string, StrConst>, repo: Map<string, StrConst>): Map<string, StrConst> {
  const m = new Map(repo);
  for (const [k, v] of local) m.set(k, v);
  return m;
}

function lookupConst(c: Ctx, repo: Map<string, StrConst>, name: string): StrConst | undefined {
  const last = name.split(".").pop() ?? name;
  return c.consts.get(last) ?? repo.get(last);
}

function modelValueExpr(args: string): string | undefined {
  const m = /\bmodel(?:_name|Name|_id|Id)?\s*[:=]\s*/.exec(args);
  if (!m) return /(^|[{,]\s*)model\s*(?=[,}])/.test(args) ? "model" : undefined;
  const rest = args.slice(m.index + m[0].length);
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      if (depth === 0) return rest.slice(0, i);
      depth--;
    } else if ((ch === "," || ch === "\n") && depth === 0) return rest.slice(0, i);
  }
  return rest;
}

function firstModelLiteral(text: string): string | undefined {
  MODEL_LIT.lastIndex = 0;
  const m = MODEL_LIT.exec(text);
  return m?.[1];
}

function resolveModel(c: Ctx, s: Site, repo: Map<string, StrConst>): string | undefined {
  const expr = modelValueExpr(s.args);
  if (expr) {
    const lit = firstModelLiteral(expr) ?? /^\s*["'`]([\w.\-/:]+)["'`]\s*$/.exec(expr)?.[1];
    if (lit) return lit;
    const id = /([A-Za-z_$][\w$.]*)\s*$/.exec(expr.trim())?.[1];
    if (id) {
      const v = lookupConst(c, repo, id);
      if (v && firstModelLiteral(`"${v.value}"`)) return v.value;
      const def = new RegExp(`\\b${id.split(".").pop()}\\s*[:=]\\s*[^\\n]*`).exec(c.p.code);
      const lit2 = def ? firstModelLiteral(def[0]) : undefined;
      if (lit2) return lit2;
    }
  }
  const gm =
    /getGenerativeModel\(\s*\{\s*model\s*:\s*["'`]([^"'`]+)/.exec(c.p.code) ??
    /GenerativeModel\(\s*(?:model_name\s*=\s*)?["']([^"']+)/.exec(c.p.code) ??
    /Chat(?:OpenAI|Anthropic|GoogleGenerativeAI|VertexAI)\(\s*\{?[^)]*?\bmodel(?:Name|_name)?\s*[:=]\s*["'`]([^"'`]+)/.exec(c.p.code);
  if (gm) return gm[1];
  const all = new Set<string>();
  MODEL_LIT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MODEL_LIT.exec(c.p.code))) all.add(m[1]);
  if (all.size === 1) {
    const only = [...all][0];
    const embedModel = /embed/i.test(only);
    if (embedModel === (s.kind === "embed")) return only;
  }
  return undefined;
}

function fnName(fn: Fn): string {
  return fn.name;
}

function buildWrappers(ctxs: Ctx[]): Wrapper[] {
  const wrappers: Wrapper[] = [];
  const has = (c: Ctx, fn: Fn) => wrappers.some((w) => w.ctx === c && w.fn === fn);
  for (const c of ctxs) {
    for (const s of c.llm) {
      if (s.provider === "local") continue;
      const fn = innermost(c.fns, s.start);
      if (!fn || fn.name.length < 3 || ["constructor", "__init__"].includes(fn.name)) continue;
      if (!has(c, fn)) wrappers.push({ name: fnName(fn), ctx: c, fn, site: s, siteCtx: c, depth: 1 });
    }
  }
  for (let depth = 2; depth <= 3; depth++) {
    const prev = wrappers.filter((w) => w.depth === depth - 1);
    for (const c of ctxs) {
      for (const fn of c.fns) {
        if (has(c, fn) || fn.name.length < 3) continue;
        const body = c.p.bare.slice(fn.start, fn.end + 1);
        for (const w of prev) {
          if (w.name === fn.name) continue;
          const res = callResolution(c, w, body);
          if (!res) continue;
          wrappers.push({ name: fn.name, ctx: c, fn, site: w.site, siteCtx: w.siteCtx, depth });
          break;
        }
      }
    }
  }
  return wrappers;
}

function callResolution(c: Ctx, w: Wrapper, text: string): Invocation["resolution"] | null {
  const esc = w.name.replace(/\$/g, "\\$");
  const direct = new RegExp(`(?<![\\w$.])${esc}\\s*\\(`).test(text);
  const method = new RegExp(`(?:this|self)\\.${esc}\\s*\\(`).test(text);
  const anyMethod = new RegExp(`\\.${esc}\\s*\\(`).test(text);
  if (w.ctx === c && (direct || method)) return "local";
  if (direct && importsName(c.p, w.name)) return "import";
  if (anyMethod && !GENERIC_NAMES.has(w.name) && w.name.length >= 6 && importsModuleOf(c, w)) return "method";
  return null;
}

function importsModuleOf(c: Ctx, w: Wrapper): boolean {
  const base = w.ctx.p.path.replace(/\.[^.]+$/, "").split("/").pop() ?? "";
  if (!base || base === "index" || base === "__init__") return true;
  return new RegExp(`\\b${base.replace(/[^\w]/g, ".")}\\b`).test(c.p.code.slice(0, 4000));
}

function invocations(c: Ctx, wrappers: Wrapper[]): Invocation[] {
  const invs: Invocation[] = [];
  for (const s of c.llm) {
    if (s.provider === "local") continue;
    invs.push({ ctx: c, start: s.start, end: s.argsEnd, line: s.line, endLine: s.endLine, site: s, siteCtx: c, resolution: "direct", label: s.api });
  }
  for (const w of wrappers) {
    const esc = w.name.replace(/\$/g, "\\$");
    const re = new RegExp(`(?<![\\w$])(?:(?:this|self|[\\w$]+)\\.)?${esc}\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(c.p.bare))) {
      const before = c.p.bare.slice(Math.max(0, m.index - 12), m.index);
      if (/(def|function|async)\s*$/.test(before)) continue;
      if (c.fns.some((f) => f.name === w.name && lineOf(c.p, m!.index) === f.line)) continue;
      if (w.ctx === c && w.fn.start <= m.index && m.index <= w.fn.end) continue;
      const lineText = c.p.lines[lineOf(c.p, m.index) - 1] ?? "";
      if (/^\s*(import|from)\b/.test(lineText) || /^\s*export\s*\{/.test(lineText)) continue;
      const res = callResolution(c, w, m[0]);
      if (!res) continue;
      const open = m.index + m[0].length - 1;
      const close = matchClose(c.p.bare, open);
      invs.push({
        ctx: c,
        start: m.index,
        end: close,
        line: lineOf(c.p, m.index),
        endLine: lineOf(c.p, close),
        site: w.site,
        siteCtx: w.siteCtx,
        wrapper: w,
        resolution: res,
        label: `${w.name}()`,
      });
    }
  }
  const uniq: Invocation[] = [];
  for (const inv of invs.sort((a, b) => a.start - b.start)) {
    if (!uniq.some((u) => u.start === inv.start)) uniq.push(inv);
  }
  return uniq;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function snippet(p: Parsed, start: number, end: number, hot: number[]): SnippetLine[] {
  const total = p.lines.length;
  const s = Math.max(1, start - 1);
  const e = Math.min(total, end + 1);
  const hotSet = new Set(hot);
  const line = (n: number): SnippetLine => ({ n, text: p.lines[n - 1].slice(0, 220), hot: hotSet.has(n) });
  if (e - s <= 16) return range(s, e).map(line);
  return [...range(s, Math.min(s + 4, e)).map(line), { n: -1, text: "", hot: false }, ...range(Math.max(e - 6, s + 5), e).map(line)];
}

function range(a: number, b: number): number[] {
  const r: number[] = [];
  for (let i = a; i <= b; i++) r.push(i);
  return r;
}

interface Make {
  pattern: PatternId;
  start: number;
  end: number;
  hot?: number[];
  severity: Level;
  confidence: Level;
  title: string;
  evidence: string[];
  kind: CallKind;
  provider?: Provider;
  model?: string;
  suggestedModel?: string;
  promptTokens?: number;
  siteKey: string;
}

function make(c: Ctx, m: Make): Finding {
  const hot = m.hot ?? range(m.start, Math.min(m.end, m.start + 3));
  return {
    id: hash(`${m.pattern}:${c.p.path}:${m.start}`),
    pattern: m.pattern,
    severity: m.severity,
    confidence: m.confidence,
    file: c.p.path,
    startLine: m.start,
    endLine: m.end,
    snippet: snippet(c.p, m.start, m.end, hot),
    title: m.title,
    evidence: m.evidence,
    callKind: m.kind,
    provider: m.provider ?? "unknown",
    model: m.model,
    suggestedModel: m.suggestedModel,
    promptTokens: m.promptTokens,
    siteKey: m.siteKey,
  };
}

const siteKey = (c: Ctx, s: Site) => `${c.p.path}:${s.line}`;
const where = (c: Ctx, s: Site) => `${c.p.path}:${s.line}`;
const bodyOf = (c: Ctx, l: { start: number; end: number }) => c.p.code.slice(l.start, l.end + 1);
const bareOf = (c: Ctx, l: { start: number; end: number }) => c.p.bare.slice(l.start, l.end + 1);

function invEvidence(inv: Invocation): string {
  if (!inv.wrapper) return `calls ${inv.site.api} directly`;
  return `calls ${inv.wrapper.name}(), which ends in ${inv.site.api} at ${where(inv.siteCtx, inv.site)}`;
}

function invConfidence(inv: Invocation): Level {
  if (inv.resolution === "direct") return "high";
  if (inv.resolution === "method") return "low";
  return inv.wrapper && inv.wrapper.depth > 2 ? "low" : "medium";
}

type Add = (f: Finding | null) => void;

function detectLoops(c: Ctx, invs: Invocation[], add: Add) {
  for (const inv of invs) {
    const loops = enclosing(c.loops, inv.start).filter((l) => l.start < inv.start);
    const loop = loops.find((l) => l.kind === "collection" && !l.smallLiteral);
    if (!loop || loops.some((l) => l.kind === "stream")) continue;
    const kind = inv.site.kind;
    const model = inv.siteCtx.models.get(inv.site);
    const conf = invConfidence(inv);
    const ev = [`loop: ${loop.header} (line ${loop.line})`, invEvidence(inv)];
    const base = { start: loop.line, end: inv.endLine, hot: [loop.line, ...range(inv.line, Math.min(inv.endLine, inv.line + 2))], kind, provider: inv.site.provider, model, siteKey: siteKey(inv.siteCtx, inv.site) };
    if (kind === "embed") {
      if (BATCH_USE.test(bodyOf(c, loop))) continue;
      add(make(c, { ...base, pattern: "unbatched-embeddings", severity: "medium", confidence: conf, title: `one embedding request per item in \`${loop.header.slice(0, 50)}\``, evidence: c.offline ? [...ev, "offline path: the batch api would also halve the price"] : ev }));
      continue;
    }
    if (AGENT_HINT.test(c.p.code.slice(loop.start, Math.min(loop.end, loop.start + 300)))) continue;
    if (c.offline && !c.usesBatch) {
      add(make(c, { ...base, pattern: "batch-api-candidate", severity: conf === "low" ? "low" : "high", confidence: conf, title: `sync llm calls in a loop inside an offline job`, evidence: [...ev, `file looks offline: ${OFFLINE_PATH.test(c.p.path) ? "path" : "script/cron entry point"}`] }));
    } else {
      add(make(c, { ...base, pattern: "n-plus-one", severity: conf === "high" ? "high" : "medium", confidence: conf, title: `one llm request per item in \`${loop.header.slice(0, 50)}\``, evidence: ev }));
    }
  }
}

function argsUnknown(args: string): boolean {
  return !args.trim() || /\.\.\.|\*\*/.test(args) || /^\s*[\w$.]+\s*$/.test(args);
}

function objectNear(c: Ctx, s: Site, ident: string): string | undefined {
  const fn = innermost(c.fns, s.start);
  const region = c.p.code.slice(fn ? fn.start : 0, s.start);
  const re = new RegExp(`\\b${ident.replace(/\$/g, "\\$")}\\s*(?::[^=]+)?=\\s*(\\{|dict\\()`, "g");
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(region))) last = m;
  if (!last) return undefined;
  const open = (fn ? fn.start : 0) + last.index + last[0].length - 1;
  return c.p.code.slice(open, matchClose(c.p.bare, open) + 1);
}

function detectMaxTokens(c: Ctx, add: Add) {
  for (const s of c.llm) {
    if (s.kind !== "chat" || s.provider === "local" || s.provider === "anthropic") continue;
    if (s.api === "langchain invoke" || s.api === "bedrock") continue;
    let text = s.args;
    let conf: Level = "high";
    if (/\.\.\.|\*\*/.test(text)) continue;
    if (/^\s*[\w$.]+\s*$/.test(text)) {
      const obj = objectNear(c, s, text.trim());
      if (!obj) continue;
      text = obj;
      conf = "medium";
    }
    if (!text.trim()) continue;
    if (MAX_KEY.test(text)) continue;
    if (s.provider === "google" && MAX_KEY.test(c.p.code)) continue;
    if (/generation_config|generationConfig|config\s*=/.test(text) && !/\{/.test(text)) continue;
    if (s.api === "ai-sdk" && /maxOutputTokens|maxTokens/.test(c.p.code)) conf = "medium";
    const model = c.models.get(s);
    add(make(c, { pattern: "missing-max-tokens", start: s.line, end: s.endLine, severity: "medium", confidence: conf, title: `${s.api} with no output token cap`, evidence: [`no max_tokens / max_completion_tokens / max_output_tokens in the call arguments`], kind: "chat", provider: s.provider, model, siteKey: siteKey(c, s) }));
  }
}

function detectRetries(c: Ctx, invs: Invocation[], repoZero: boolean, add: Add) {
  for (const loop of c.loops) {
    if (loop.kind !== "retry" && loop.kind !== "infinite") continue;
    const body = bodyOf(c, loop);
    const bare = bareOf(c, loop);
    if (!/\btry\b/.test(bare) && !/\.catch\s*\(/.test(bare)) continue;
    if (/\binput\s*\(|readline|prompt\(/.test(bare)) continue;
    if (loop.kind === "infinite" && AGENT_HINT.test(body)) continue;
    const inside = invs.filter((i) => i.start > loop.start && i.start < loop.end);
    const httpInside = c.http.filter((h) => h.start > loop.start && h.start < loop.end);
    if (!inside.length && !httpInside.length) continue;
    const target = inside[0];
    const hasBackoff = /sleep|setTimeout|delay|backoff|wait_?for|jitter|asyncio\.sleep|time\.sleep|\bwait\s*\(/i.test(bare);
    const bounded = loop.kind === "retry" || (/(attempt|retr|tries|count|max_?\w*)\s*(>=?|<=?|==)/i.test(bare) && /\b(raise|throw|break|return)\b/.test(bare));
    const sdkSite = target && ["openai", "anthropic", "google"].includes(target.site.provider) && !/^rest|litellm/.test(target.site.api);
    const n = Number(/(\d+)/.exec(loop.header)?.[1] ?? NaN);
    const lineHot = [loop.line, ...(target ? [target.line] : httpInside.length ? [httpInside[0].line] : [])];
    const kind: CallKind = target ? target.site.kind : "http";
    const base = { start: loop.line, end: target ? target.endLine : httpInside[0].endLine, hot: lineHot, kind, provider: target?.site.provider ?? "unknown", model: target ? target.siteCtx.models.get(target.site) : undefined, siteKey: target ? siteKey(target.siteCtx, target.site) : `${c.p.path}:${loop.line}` };
    const callDesc = target ? invEvidence(target) : `calls ${httpInside[0].api}`;
    if (!bounded) {
      add(make(c, { ...base, pattern: "retry-storm", severity: "high", confidence: "high", title: "retry loop with no attempt cap", evidence: [`loop: ${loop.header} (line ${loop.line})`, "catches errors and loops again with no counter or limit", callDesc] }));
    } else if (!hasBackoff) {
      add(make(c, { ...base, pattern: "retry-storm", severity: "medium", confidence: "high", title: "retry loop with no backoff", evidence: [`loop: ${loop.header} (line ${loop.line})`, "retries immediately: no sleep, delay or backoff in the loop", callDesc, ...(sdkSite && !repoZero ? ["the sdk also retries 2 times by default under this loop"] : [])] }));
    } else if (sdkSite && !repoZero) {
      add(make(c, { ...base, pattern: "retry-storm", severity: "low", confidence: "medium", title: "manual retries stacked on sdk retries", evidence: [`loop: ${loop.header} (line ${loop.line})`, `the ${target!.site.provider} sdk already retries 429/5xx 2 times by default, so each attempt here can be ${Number.isFinite(n) ? `up to ${n} x 3 = ${n * 3} requests` : "3 requests"}`, "no max_retries=0 found in the repo", callDesc] }));
    }
  }
  if (c.p.lang === "py" && /tenacity|import\s+backoff|from\s+backoff/.test(c.p.code)) {
    const re = /^[ \t]*@(retry|tenacity\.retry|backoff\.on_exception|backoff\.on_predicate)\b(\s*\()?/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(c.p.bare))) {
      const line = lineOf(c.p, m.index);
      let args = "";
      if (m[2]) {
        const open = m.index + m[0].length - 1;
        args = c.p.code.slice(open, matchClose(c.p.bare, open) + 1);
      }
      const fn = c.fns.find((f) => f.start > m!.index && f.line <= line + 6);
      if (!fn) continue;
      const invs = c.llm.filter((s) => s.start > fn.start && s.start < fn.end);
      const https = c.http.filter((s) => s.start > fn.start && s.start < fn.end);
      if (!invs.length && !https.length) continue;
      const isTenacity = m[1].includes("retry");
      const capped = isTenacity ? /\bstop\s*=/.test(args) : /max_tries|max_time/.test(args);
      const s = invs[0] ?? https[0];
      const base = { start: line, end: fn.line, kind: s.kind, provider: s.provider, model: c.models.get(s), siteKey: siteKey(c, s) };
      if (!capped) {
        add(make(c, { ...base, pattern: "retry-storm", severity: "high", confidence: "high", title: `@${m[1]} with no stop condition`, evidence: [isTenacity ? "tenacity retries forever unless stop= is set" : "backoff retries forever unless max_tries or max_time is set", `wraps ${fn.name}(), which calls ${s.api} at line ${s.line}`] }));
      } else if (invs.length && ["openai", "anthropic"].includes(s.provider) && !/max_retries\s*=\s*0/.test(c.p.code)) {
        add(make(c, { ...base, pattern: "retry-storm", severity: "low", confidence: "medium", title: `@${m[1]} stacked on sdk retries`, evidence: ["the official sdk already retries 2 times by default", `wraps ${fn.name}(), which calls ${s.api} at line ${s.line}`] }));
      }
    }
  }
}

const SIMPLE_TASK = /\b(classify|classification|categori[sz]e|categori[sz]ation|sentiment|yes or no|yes\/no|true or false|one word|single word|respond with only|reply with only|answer with only|return only|output only|only (?:the|a|one) (?:number|label|category|word|letter)|is this (?:spam|message|email|text)|spam or not|detect the language|which category|extract (?:the )?(?:name|email|date|phone|fields?|entities|keywords))\b/i;

function contextStrings(c: Ctx, s: Site, repo: Map<string, StrConst>): string {
  const parts = [stringText(c.p, s.argsStart, s.argsEnd)];
  for (const id of c.p.bare.slice(s.argsStart, s.argsEnd).match(/[A-Za-z_$][\w$]*/g) ?? []) {
    const v = lookupConst(c, repo, id);
    if (v) parts.push(v.value.slice(0, 4000));
  }
  const fn = innermost(c.fns, s.start);
  const from = Math.max(fn ? fn.start : 0, c.p.lineStarts[Math.max(0, s.line - 26)]);
  parts.push(stringText(c.p, from, s.start));
  return parts.join(" ");
}

function detectExpensiveModel(c: Ctx, repo: Map<string, StrConst>, add: Add) {
  for (const s of c.llm) {
    if (s.kind !== "chat" || s.provider === "local") continue;
    const model = c.models.get(s);
    if (!model) continue;
    const tier = tierOf(model);
    if (tier !== "top" && tier !== "mid") continue;
    const text = contextStrings(c, s, repo);
    const kw = SIMPLE_TASK.exec(text);
    const maxTok = Number(/\b(?:max_tokens|max_completion_tokens|max_output_tokens|maxTokens|maxOutputTokens)\s*[:=]\s*(\d+)/.exec(s.args)?.[1] ?? NaN);
    const short = Number.isFinite(maxTok) && maxTok <= 50;
    if (!kw && !(Number.isFinite(maxTok) && maxTok <= 20)) continue;
    const provider = providerOfModel(model);
    const alt = CHEAP_ALTERNATIVE[provider];
    if (!alt || findPrice(alt)?.id === findPrice(model)?.id) continue;
    const conf: Level = kw && short ? "high" : "medium";
    const evidence = [`model: ${model} (${tier === "top" ? "top tier" : "mid tier"})`];
    if (kw) evidence.push(`prompt reads like a simple task: "${kw[0]}"`);
    if (Number.isFinite(maxTok)) evidence.push(`output capped at ${maxTok} tokens${short ? ", so the answer is short" : ""}`);
    add(make(c, { pattern: "expensive-model", start: s.line, end: s.endLine, severity: tier === "top" ? "high" : "medium", confidence: conf, title: kw ? `${model} on a simple task ("${kw[0].toLowerCase()}")` : `${model} for a ${maxTok}-token answer`, evidence, kind: "chat", provider, model, suggestedModel: alt, siteKey: siteKey(c, s) }));
  }
}

function resolvePrompt(c: Ctx, repo: Map<string, StrConst>, expr: string, s: Site): { value: string; dynamic: boolean; name: string } | undefined {
  const e = expr.trim();
  const id = /^([A-Za-z_$][\w$.]*)(?:\.trim\(\)|\.strip\(\))?$/.exec(e)?.[1];
  if (id) {
    const v = lookupConst(c, repo, id);
    if (v) return { value: v.value, dynamic: v.dynamic, name: id };
    return undefined;
  }
  const qi = c.p.code.indexOf(e.slice(0, 40), s.argsStart);
  if (/^[fF]?["'`]/.test(e) && qi >= 0) {
    return { value: e.replace(/^[fF]?(["'`]{1,3})/, "").replace(/(["'`]{1,3})$/, ""), dynamic: /\$\{|^[fF]["']/.test(e), name: "inline prompt" };
  }
  return undefined;
}

function argValue(args: string, key: string): string | undefined {
  const m = new RegExp(`(?:^|[\\s,{(])["']?${key}["']?\\s*[:=]\\s*`).exec(args);
  if (!m) return undefined;
  const rest = args.slice(m.index + m[0].length);
  let depth = 0;
  let q: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (q) {
      if (ch === "\\") i++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") q = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      if (depth === 0) return rest.slice(0, i);
      depth--;
    } else if (ch === "," && depth === 0) return rest.slice(0, i);
  }
  return rest;
}

function detectCaching(c: Ctx, repo: Map<string, StrConst>, add: Add) {
  for (const s of c.llm) {
    if (s.kind !== "chat" || s.provider === "local") continue;
    const model = c.models.get(s);
    let expr: string | undefined;
    if (s.provider === "anthropic") expr = argValue(s.args, "system");
    if (!expr) {
      const sys = /role["']?\s*[:=]\s*["']system["']\s*,\s*["']?content["']?\s*[:=]\s*([\w$.]+|[fF]?["'`])/.exec(s.args);
      if (sys) expr = sys[1].length > 1 ? sys[1] : undefined;
    }
    if (!expr) continue;
    if (/cache_control|cacheControl/.test(expr)) continue;
    const prompt = resolvePrompt(c, repo, expr, s);
    if (!prompt) continue;
    const tokens = Math.round(prompt.value.length / 4);
    const firstDyn = prompt.dynamic ? prompt.value.search(/\$\{|\{[A-Za-z_]/) : -1;
    const fileCaches = /cache_control|cacheControl|cachePoint/.test(c.p.code);
    if (s.provider === "anthropic" && !prompt.dynamic && tokens >= 512 && !fileCaches) {
      add(make(c, { pattern: "no-prompt-caching", start: s.line, end: s.endLine, severity: tokens >= 2000 ? "high" : "medium", confidence: tokens >= 1024 ? "high" : "medium", title: `~${tokens.toLocaleString("en-US")} token static system prompt sent uncached`, evidence: [`system prompt: ${prompt.name} (${prompt.value.length.toLocaleString("en-US")} chars, ~${tokens.toLocaleString("en-US")} tokens)`, "no cache_control anywhere in this file", "current claude models cache prompts from 512 tokens up; some older ones need 1024+"], kind: "chat", provider: s.provider, model, promptTokens: tokens, siteKey: siteKey(c, s) }));
    } else if (prompt.dynamic && tokens >= 1024 && firstDyn >= 0 && firstDyn < prompt.value.length * 0.3 && (s.provider === "openai" || fileCaches || s.provider === "anthropic")) {
      add(make(c, { pattern: "no-prompt-caching", start: s.line, end: s.endLine, severity: "medium", confidence: "medium", title: `dynamic value near the top of a ~${tokens.toLocaleString("en-US")} token prompt breaks caching`, evidence: [`system prompt: ${prompt.name} (~${tokens.toLocaleString("en-US")} tokens)`, `first interpolation at character ${firstDyn} of ${prompt.value.length}`, "prompt caching matches on the exact prefix, so anything that changes early invalidates everything after it"], kind: "chat", provider: s.provider, model, promptTokens: tokens, siteKey: siteKey(c, s) }));
    }
  }
}

const TRIM =
  /\.slice\(|\.splice\(|\.shift\(|\[\s*-\s*\d+\s*:|\.pop\(\s*0\s*\)|del\s+[\w.]+\[|trim|truncat|summar|compact|max_?history|history_?limit|maxHistory|window|count_?tokens|countTokens|tiktoken|token_?limit|max_?turns|maxTurns|max_?messages|MAX_MESSAGES|context_?limit/i;

function detectHistory(c: Ctx, add: Add) {
  for (const s of c.llm) {
    if (s.kind !== "chat" || s.provider === "local") continue;
    let ident = /\b(?:messages|contents|input|history)\s*[:=]\s*((?:self\.|this\.)?[A-Za-z_$][\w$]*)\s*(?=[,)\n}]|$)/.exec(s.args)?.[1];
    if (!ident && /(^|[{,]\s*)messages\s*(?=[,}])/.test(s.args)) ident = "messages";
    if (!ident && s.api === "langchain invoke") ident = /^\s*((?:self\.|this\.)?[A-Za-z_$][\w$]*)\s*$/.exec(s.args)?.[1];
    if (!ident || /^(messages_?for|prompt|req|request|body|payload|params|kwargs)$/i.test(ident)) {
      if (!ident) continue;
    }
    const esc = ident.replace(/[.$]/g, (ch) => `\\${ch}`);
    const growRe = new RegExp(`${esc}\\s*\\.\\s*(push|append|extend)\\s*\\(|${esc}\\s*\\+=|${esc}\\s*=\\s*\\[\\s*\\.\\.\\.\\s*${esc}\\b|${esc}\\s*=\\s*${esc}\\s*\\+|${esc}\\s*\\.\\s*concat\\(`);
    const grow = growRe.exec(c.p.bare);
    if (!grow) continue;
    const fn = innermost(c.fns, s.start);
    const scope = fn && !/^(self|this)\./.test(ident) ? c.p.code.slice(fn.start, fn.end + 1) : c.p.code;
    const trimRe = new RegExp(`${esc}[^\\n]{0,40}${TRIM.source}|${TRIM.source}[^\\n]{0,40}${esc}`, "i");
    if (trimRe.test(scope) || /max_?history|maxHistory|history_?limit|MAX_MESSAGES|max_?turns|summari[sz]e_?history|trim_?messages|trimMessages/i.test(c.p.code)) continue;
    const growLine = lineOf(c.p, grow.index);
    const loop = enclosing(c.loops, s.start).find((l) => l.start <= grow.index && grow.index <= l.end && l.kind !== "retry" && l.kind !== "stream");
    const member = /^(self|this)\./.test(ident);
    const model = c.models.get(s);
    const base = { start: Math.min(growLine, s.line), end: Math.max(growLine, s.endLine), hot: [growLine, s.line], kind: "chat" as CallKind, provider: s.provider, model, siteKey: siteKey(c, s) };
    if (loop) {
      const agent = AGENT_HINT.test(bodyOf(c, loop));
      if (agent) {
        if (/cache_control|cacheControl/.test(c.p.code)) continue;
        add(make(c, { ...base, pattern: "history-resend", severity: "low", confidence: "medium", title: `agent loop resends the whole transcript every step`, evidence: [`\`${ident}\` grows at line ${growLine} inside \`${loop.header.slice(0, 50)}\``, "the full transcript goes back on every tool step, with no trimming or caching", "fix here is caching the stable prefix more than trimming"] }));
      } else {
        add(make(c, { ...base, pattern: "history-resend", severity: "high", confidence: "high", title: `\`${ident}\` grows every turn and is resent in full`, evidence: [`\`${ident}\` is appended to at line ${growLine} inside \`${loop.header.slice(0, 50)}\` (line ${loop.line})`, `the whole array is passed to ${s.api} at line ${s.line}`, "no slicing, windowing, token counting or summarizing found"] }));
      }
    } else if (member) {
      add(make(c, { ...base, pattern: "history-resend", severity: "medium", confidence: "medium", title: `\`${ident}\` keeps every turn and is resent in full`, evidence: [`\`${ident}\` is appended to at line ${growLine} and lives on the object across calls`, `the whole array is passed to ${s.api} at line ${s.line}`, "no slicing, windowing, token counting or summarizing found"] }));
    }
  }
}

const SOURCES_JS = /readFileSync\(|\breadFile\(|\.findMany\(\s*\)|\.find\(\s*\{\s*\}\s*\)|select\s+\*\s+from|\.toArray\(\)|JSON\.stringify\(\s*(?:rows|records|results|data|docs|documents|items|entries|all\w*|logs|dump|table|users|orders|products|transactions)\s*[,)]/gi;
const SOURCES_PY = /\.read\(\)|\.read_text\(\)|\.fetchall\(\)|\.objects\.all\(\)|\.to_string\(\)|\.to_csv\(|\.to_markdown\(|select\s+\*\s+from|json\.dumps\(\s*(?:rows|records|results|data|docs|documents|items|entries|logs|users|orders)\s*[,)]|\.extract_text\(\)/gi;
const TRUNC = /\.slice\(\s*0|\.substring\(|\.substr\(|\[\s*:\s*\d|\[\s*0\s*:|truncat|chunk|split_text|text_splitter|TextSplitter|max_chars|MAX_CHARS|max_len|limit\s*\(/i;

function detectOversized(c: Ctx, invs: Invocation[], add: Add) {
  const re = c.p.lang === "js" ? SOURCES_JS : SOURCES_PY;
  const targets = new Set<number>();
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(c.p.code))) {
    const line = lineOf(c.p, m.index);
    const lineStart = c.p.lineStarts[line - 1];
    const before = c.p.code.slice(lineStart, m.index);
    const fn = innermost(c.fns, m.index);
    const region = { start: m.index, end: fn ? fn.end : c.p.code.length - 1 };
    const direct = invs.find((i) => i.start <= m!.index && m!.index <= i.end);
    let target: Invocation | undefined = direct;
    let varName: string | undefined;
    if (!target) {
      varName = /(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?[^=]*$/.exec(before)?.[1];
      if (!varName || /^(if|return)$/.test(varName)) continue;
      const after = invs.filter((i) => i.start > m!.index && i.start <= region.end);
      if (!after.length) continue;
      const v = varName.replace(/\$/g, "\\$");
      const used = new RegExp(`\\$\\{[^}\\n]*\\b${v}\\b|\\{[^{}\\n]*\\b${v}\\b[^{}\\n]*\\}|\\{\\s*${v}\\s*[}!:\\[]|[+]\\s*${v}\\b|\\b${v}\\s*\\+|format\\([^)]*\\b${v}\\b|%\\s*\\(?\\s*${v}\\b|content["']?\\s*[:=]\\s*${v}\\b`);
      const regionText = c.p.code.slice(m.index + m[0].length, region.end + 1);
      if (!used.test(regionText)) continue;
      if (new RegExp(`\\b${v}\\b[^\\n]{0,30}${TRUNC.source}`, "i").test(regionText) || TRUNC.test(c.p.code.slice(lineStart, m.index + 200))) continue;
      target = after.find((i) => new RegExp(`\\b${v}\\b`).test(c.p.code.slice(i.start, i.end))) ?? after[0];
    } else if (TRUNC.test(c.p.code.slice(target.start, target.end))) continue;
    if (targets.has(target.start)) continue;
    targets.add(target.start);
    const s = target.site;
    const label = /select/i.test(m[0]) ? "select * query" : `${m[0].replace(/\(.*/, "").replace(/^\./, "").trim()}()`;
    const inArgs = !!direct || (varName ? new RegExp(`\\b${varName.replace(/\$/g, "\\$")}\\b`).test(c.p.code.slice(target.start, target.end)) : false);
    add(make(c, {
      pattern: "oversized-context",
      start: line,
      end: Math.max(line, target.line),
      hot: [line, target.line],
      severity: "medium",
      confidence: inArgs ? "high" : "medium",
      title: `${label} result goes straight into a prompt`,
      evidence: [`line ${line}: ${c.p.lines[line - 1].trim().slice(0, 100)}`, varName ? `\`${varName}\` is interpolated into the prompt with no slicing or chunking` : "the full result is passed in the call arguments", invEvidence(target)],
      kind: s.kind,
      provider: s.provider,
      model: target.siteCtx.models.get(s),
      siteKey: siteKey(target.siteCtx, s),
    }));
  }
}

const LITERAL_WORDS = new Set(["true", "false", "True", "False", "None", "null", "undefined", "await", "new", "dict", "list", "as", "const"]);

function detectStaticCalls(c: Ctx, invs: Invocation[], repo: Map<string, StrConst>, add: Add) {
  if (c.cachePrims) return;
  for (const s of c.llm) {
    if (s.provider === "local" || s.api === "langchain invoke") continue;
    if (!/(messages|prompt|contents|input)\b/.test(s.args)) continue;
    const bare = c.p.bare.slice(s.argsStart, s.argsEnd);
    const ids = [...bare.matchAll(/([A-Za-z_$][\w$]*)(\s*[:=](?!=))?/g)].filter((m) => !m[2] && !LITERAL_WORDS.has(m[1])).map((m) => m[1]);
    const modelExpr = modelValueExpr(s.args) ?? "";
    const leftover = ids.filter((id) => {
      if (modelExpr.includes(id)) return false;
      const v = lookupConst(c, repo, id);
      return !(v && !v.dynamic);
    });
    if (leftover.length) continue;
    if (!stringText(c.p, s.argsStart, s.argsEnd).trim()) continue;
    const loop = enclosing(c.loops, s.start).find((l) => l.kind === "collection" || l.kind === "infinite" || l.kind === "other");
    const fn = innermost(c.fns, s.start);
    const called = fn ? invs.some((i) => i.wrapper?.fn === fn) : false;
    if (!loop && !called) continue;
    add(make(c, { pattern: "no-response-cache", start: s.line, end: s.endLine, severity: loop ? "high" : "medium", confidence: loop ? "high" : "medium", title: "same static request sent every time", evidence: ["every value in the request is a literal or a constant, so the answer barely changes between calls", loop ? `runs inside \`${loop.header.slice(0, 50)}\` (line ${loop.line})` : `inside ${fn?.name}(), which is called from other code`, "no memoization or response cache found in this file"], kind: s.kind, provider: s.provider, model: c.models.get(s), siteKey: siteKey(c, s) }));
  }
}

function detectDuplicateInvocations(c: Ctx, invs: Invocation[], add: Add) {
  if (c.cachePrims) return;
  const byFn = new Map<Fn | undefined, Invocation[]>();
  for (const inv of invs) {
    const fn = innermost(c.fns, inv.start);
    byFn.set(fn, [...(byFn.get(fn) ?? []), inv]);
  }
  for (const [, list] of byFn) {
    for (let i = 1; i < list.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = list[j];
        const b = list[i];
        const ta = c.p.code.slice(a.start, a.end + 1).replace(/\s+/g, "");
        const tb = c.p.code.slice(b.start, b.end + 1).replace(/\s+/g, "");
        if (ta !== tb || ta.length < 12) continue;
        const between = c.p.bare.slice(a.end, b.start);
        if (/\b(else|elif|except|catch|case|return|yield|finally)\b/.test(between)) continue;
        if (enclosing(c.loops, a.start).length !== enclosing(c.loops, b.start).length) continue;
        add(make(c, { pattern: "no-response-cache", start: a.line, end: b.endLine, hot: [a.line, b.line], severity: "medium", confidence: "medium", title: `identical ${b.label} call made twice`, evidence: [`line ${a.line} and line ${b.line} make the exact same call with the same arguments`, invEvidence(b)], kind: b.site.kind, provider: b.site.provider, model: b.siteCtx.models.get(b.site), siteKey: siteKey(b.siteCtx, b.site) }));
        break;
      }
    }
  }
}

function detectPolling(c: Ctx, invs: Invocation[], add: Add) {
  if (c.p.lang === "js") {
    const re = /\bsetInterval\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(c.p.bare))) {
      const open = m.index + m[0].length - 1;
      const close = matchClose(c.p.bare, open);
      const args = c.p.code.slice(open + 1, close);
      const span = { start: open, end: close };
      const call = c.http.find((h) => h.start > span.start && h.start < span.end) ?? invs.find((i) => i.start > span.start && i.start < span.end);
      if (!call) continue;
      const msRaw = /,\s*([\d_]+)\s*$/.exec(args)?.[1];
      const ms = msRaw ? Number(msRaw.replace(/_/g, "")) : NaN;
      if (Number.isFinite(ms) && ms > 15000) continue;
      const line = lineOf(c.p, m.index);
      const hidden = /document\.hidden|visibilityState/.test(args);
      const callLine = lineOf(c.p, call.start);
      add(make(c, { pattern: "polling-no-backoff", start: line, end: lineOf(c.p, close), hot: [line, callLine], severity: Number.isFinite(ms) && ms <= 5000 && !hidden ? "medium" : "low", confidence: "high", title: `polls every ${Number.isFinite(ms) ? `${ms / 1000}s` : "fixed interval"} with setInterval`, evidence: [`setInterval at line ${line}${Number.isFinite(ms) ? ` with a ${ms}ms interval` : ""}`, `makes a request each tick at line ${callLine}`, hidden ? "pauses when the tab is hidden" : "keeps polling when the tab is hidden and when nothing changed"], kind: "site" in call ? call.site.kind : "http", provider: "site" in call ? call.site.provider : "unknown", siteKey: `${c.p.path}:${callLine}` }));
    }
  }
  for (const loop of c.loops) {
    if (loop.kind !== "infinite" && loop.kind !== "other") continue;
    const bare = bareOf(c, loop);
    const body = bodyOf(c, loop);
    if (/\binput\s*\(|readline|queue\.get|\.pop\(|brpop|blpop|receive_message|recv\(|accept\(/.test(body) || AGENT_HINT.test(body)) continue;
    const call = c.http.find((h) => h.start > loop.start && h.start < loop.end && /get|fetch|urlopen|request/i.test(h.api));
    if (!call) continue;
    const sleep = /(?:time\.sleep|asyncio\.sleep|sleep)\(\s*([\d.]+)\s*\)|setTimeout\([^,]+,\s*([\d_]+)\s*\)/.exec(body);
    if (!sleep) continue;
    if (/\*=|\*\*|backoff|Math\.min|min\(|delay\s*=\s*delay|if-none-match|if-modified-since|etag/i.test(body)) continue;
    if (/\btry\b/.test(bare) && loop.kind !== "infinite") continue;
    const secs = sleep[1] ? Number(sleep[1]) : Number((sleep[2] ?? "0").replace(/_/g, "")) / 1000;
    const callLine = lineOf(c.p, call.start);
    add(make(c, { pattern: "polling-no-backoff", start: loop.line, end: callLine, hot: [loop.line, callLine], severity: secs <= 5 ? "medium" : "low", confidence: "medium", title: `polling loop with a fixed ${secs}s sleep`, evidence: [`loop: ${loop.header} (line ${loop.line})`, `requests ${call.api} every ${secs}s with no backoff or conditional request`], kind: "http", provider: "unknown", siteKey: `${c.p.path}:${callLine}` }));
  }
}

function detectDuplicateFetch(c: Ctx, invs: Invocation[], add: Add) {
  for (const h of c.http) {
    const loop = enclosing(c.loops, h.start).find((l) => l.kind === "collection" && l.start < h.start);
    if (!loop) continue;
    const body = bareOf(c, loop);
    const scoped = new Set(loop.vars);
    for (const m of body.matchAll(/(?:const|let|var)\s+(?:\{([^}]*)\}|\[([^\]]*)\]|([A-Za-z_$][\w$]*))/g)) {
      for (const id of (m[1] ?? m[2] ?? m[3] ?? "").match(/[A-Za-z_$][\w$]*/g) ?? []) scoped.add(id);
    }
    for (const m of body.matchAll(/(?:^|[\s;(])([A-Za-z_$][\w$]*)\s*(?:\+|-)?=(?!=)/gm)) scoped.add(m[1]);
    for (const m of body.matchAll(/\b(?:for|with)\s+.*?\bas\s+([A-Za-z_]\w*)/g)) scoped.add(m[1]);
    const ids = c.p.bare.slice(h.argsStart, h.argsEnd).match(/[A-Za-z_$][\w$]*/g) ?? [];
    const strs = stringText(c.p, h.argsStart, h.argsEnd);
    if (ids.some((id) => scoped.has(id) || /^(i|j|k|idx|index|page|cursor|offset|next\w*)$/i.test(id))) continue;
    if (!ids.length && !strs.trim()) continue;
    if (loop.header.includes(".map") && /Promise\.all/.test(c.p.code.slice(Math.max(0, loop.start - 40), loop.start))) {
      if (ids.length === 0 && !strs.trim()) continue;
    }
    add(make(c, { pattern: "duplicate-fetch", start: loop.line, end: h.endLine, hot: [loop.line, h.line], severity: "medium", confidence: "high", title: `same request repeated on every iteration`, evidence: [`loop: ${loop.header} (line ${loop.line})`, `${h.api}(${c.p.code.slice(h.argsStart, h.argsEnd).trim().slice(0, 60)}) does not use the loop variable, so every iteration sends the same request`], kind: "http", provider: "unknown", siteKey: `${c.p.path}:${h.line}` }));
  }
  if (c.p.lang === "js" && /useEffect/.test(c.p.code)) {
    const re = /\buseEffect\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(c.p.bare))) {
      const open = m.index + m[0].length - 1;
      const close = matchClose(c.p.bare, open);
      const call = c.http.find((h) => h.start > open && h.start < close) ?? invs.find((i) => i.start > open && i.start < close);
      if (!call) continue;
      let depth = 0;
      let hasDeps = false;
      for (let i = open + 1; i < close; i++) {
        const ch = c.p.bare[i];
        if ("([{".includes(ch)) depth++;
        else if (")]}".includes(ch)) depth--;
        else if (ch === "," && depth === 0) hasDeps = true;
      }
      if (hasDeps) continue;
      const line = lineOf(c.p, m.index);
      const callLine = lineOf(c.p, call.start);
      add(make(c, { pattern: "duplicate-fetch", start: line, end: lineOf(c.p, close), hot: [line, callLine], severity: "high", confidence: "high", title: "useEffect with no dependency array fetches on every render", evidence: [`useEffect at line ${line} has no second argument, so it runs after every render`, `and makes a request at line ${callLine}`], kind: "site" in call ? call.site.kind : "http", provider: "site" in call ? call.site.provider : "unknown", siteKey: `${c.p.path}:${callLine}` }));
    }
  }
  const byFn = new Map<Fn | undefined, Site[]>();
  for (const h of c.http) {
    const fn = innermost(c.fns, h.start);
    byFn.set(fn, [...(byFn.get(fn) ?? []), h]);
  }
  for (const [, list] of byFn) {
    for (let i = 1; i < list.length; i++) {
      const b = list[i];
      const tb = (b.api + b.args).replace(/\s+/g, "");
      const a = list.slice(0, i).find((x) => (x.api + x.args).replace(/\s+/g, "") === tb);
      if (!a || tb.length < 14 || /post|put|patch/i.test(b.api) || /method\s*:\s*["'](POST|PUT|PATCH|DELETE)/i.test(b.args)) continue;
      const between = c.p.bare.slice(a.argsEnd, b.start);
      if (/\b(else|elif|except|catch|case|return|finally)\b/.test(between)) continue;
      add(make(c, { pattern: "duplicate-fetch", start: a.line, end: b.endLine, hot: [a.line, b.line], severity: "low", confidence: "medium", title: `same ${b.api} request made twice in one function`, evidence: [`line ${a.line} and line ${b.line} send the identical request`], kind: "http", provider: "unknown", siteKey: `${c.p.path}:${b.line}` }));
    }
  }
}
