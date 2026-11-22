import type { CallKind, Provider } from "../types";
import { indentOf, lineOf, matchClose, type Parsed } from "./source";

export type LoopKind = "collection" | "retry" | "infinite" | "stream" | "other";

export interface Loop {
  kind: LoopKind;
  start: number;
  end: number;
  header: string;
  vars: string[];
  smallLiteral: boolean;
  line: number;
}

export interface Fn {
  name: string;
  start: number;
  end: number;
  line: number;
}

export interface Site {
  kind: CallKind;
  provider: Provider;
  api: string;
  start: number;
  argsStart: number;
  argsEnd: number;
  args: string;
  line: number;
  endLine: number;
}

export interface StrConst {
  value: string;
  dynamic: boolean;
  line: number;
}

const RETRY_VAR = /^(attempts?|retry|retries|tries|try_?count|_|n_?tries|i_?retry)$/i;
const RETRY_BOUND = /retr|attempt|tries|max_?try/i;
const STREAM_ITER = /\b(stream|chunks?|events?|reader|response|resp|completion|res|lines|sse)\b/i;

export function findLoops(p: Parsed): Loop[] {
  return p.lang === "js" ? jsLoops(p) : pyLoops(p);
}

function jsLoops(p: Parsed): Loop[] {
  const loops: Loop[] = [];
  const b = p.bare;
  const re = /\b(for\s*(?:await\s*)?\(|while\s*\()|\.(forEach|map|flatMap)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(b))) {
    const parenIdx = m.index + m[0].length - 1;
    const close = matchClose(b, parenIdx);
    const header = p.code.slice(parenIdx + 1, close);
    if (m[2]) {
      const before = p.code.slice(Math.max(0, m.index - 80), m.index);
      const recv = /([\w$.\]\)]+)\s*$/.exec(before)?.[1] ?? "";
      const params = /^\s*(?:async\s*)?(?:\(([^)]*)\)|([\w$]+))\s*=>|^\s*(?:async\s+)?function\s*\w*\s*\(([^)]*)\)/.exec(header);
      const vars = identList(params?.[1] ?? params?.[2] ?? params?.[3] ?? "");
      const literal = /^\s*\[/.test(p.code.slice(Math.max(0, m.index - 200), m.index).split(/[=(,]/).pop() ?? "");
      loops.push({
        kind: STREAM_ITER.test(recv) && !/\w+s$/.test(recv) ? "stream" : "collection",
        start: m.index,
        end: close,
        header: `${recv}.${m[2]}`,
        vars,
        smallLiteral: literal && smallArray(p.code.slice(Math.max(0, m.index - 200), m.index)),
        line: lineOf(p, m.index),
      });
      continue;
    }
    let bodyStart = close + 1;
    while (bodyStart < b.length && /\s/.test(b[bodyStart])) bodyStart++;
    const bodyEnd = b[bodyStart] === "{" ? matchClose(b, bodyStart) : statementEnd(b, bodyStart);
    const isFor = m[1].startsWith("for");
    let kind: LoopKind = "other";
    let vars: string[] = [];
    let smallLiteral = false;
    if (isFor) {
      const of = /^\s*(?:const|let|var)?\s*([\s\S]+?)\s+(of|in)\s+([\s\S]+)$/.exec(header);
      if (of) {
        vars = identList(of[1]);
        const iter = of[3].trim();
        smallLiteral = /^\[/.test(iter) && countTopLevel(iter) <= 3;
        kind = STREAM_ITER.test(iter) && !/s$/.test(iter.replace(/\W+$/, "")) ? "stream" : "collection";
        if (/^(await\s+)?[\w$.]*(stream|reader|events)\b/i.test(iter)) kind = "stream";
      } else if (/^\s*;\s*;\s*$/.test(header)) {
        kind = "infinite";
      } else {
        const parts = header.split(";");
        const decl = /(?:let|var)?\s*([\w$]+)\s*=/.exec(parts[0] ?? "");
        if (decl) vars = [decl[1]];
        const cond = parts[1] ?? "";
        if (RETRY_BOUND.test(cond) || (decl && RETRY_VAR.test(decl[1]))) kind = "retry";
        else if (/<=?\s*\d+\s*$/.test(cond.trim()) && Number(/(\d+)\s*$/.exec(cond.trim())?.[1]) <= 5) kind = "retry";
        else kind = "collection";
      }
    } else {
      const cond = header.trim();
      if (/^(true|1|!0)$/.test(cond)) kind = "infinite";
      else if (RETRY_BOUND.test(cond)) kind = "retry";
      else kind = "other";
    }
    loops.push({ kind, start: m.index, end: bodyEnd, header: header.trim().slice(0, 120), vars, smallLiteral, line: lineOf(p, m.index) });
  }
  return loops;
}

function statementEnd(b: string, from: number): number {
  let depth = 0;
  for (let i = from; i < b.length; i++) {
    const c = b[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (depth <= 0 && (c === ";" || (c === "\n" && depth === 0 && i > from + 1))) return i;
    if (depth < 0) return i;
  }
  return b.length - 1;
}

function identList(s: string): string[] {
  return (s.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((w) => !["const", "let", "var", "async", "await"].includes(w));
}

function countTopLevel(arr: string): number {
  const inner = arr.trim().replace(/^\[/, "").replace(/\]\s*$/, "");
  if (!inner.trim()) return 0;
  return inner.split(",").filter((x) => x.trim()).length;
}

function smallArray(before: string): boolean {
  const m = /\[([^\[\]]*)\]\s*$/.exec(before.replace(/\)\s*$/, ""));
  return !!m && countTopLevel(`[${m[1]}]`) <= 3;
}

function blockEnd(p: Parsed, headerLine: number): number {
  const lines = p.lines;
  let headerEndLine = headerLine;
  while (headerEndLine < lines.length && !/:\s*$/.test(p.bare.slice(p.lineStarts[headerEndLine - 1], (p.lineStarts[headerEndLine] ?? p.bare.length + 1) - 1))) {
    headerEndLine++;
    if (headerEndLine - headerLine > 20) break;
  }
  const baseIndent = indentOf(lines[headerLine - 1]);
  let last = headerEndLine;
  for (let ln = headerEndLine + 1; ln <= lines.length; ln++) {
    const bareLine = p.bare.slice(p.lineStarts[ln - 1], (p.lineStarts[ln] ?? p.bare.length + 1) - 1);
    if (!bareLine.trim()) continue;
    if (indentOf(lines[ln - 1]) <= baseIndent && bareLine.trim() !== "") break;
    last = ln;
  }
  return (p.lineStarts[last] ?? p.raw.length + 1) - 1;
}

function pyLoops(p: Parsed): Loop[] {
  const loops: Loop[] = [];
  const re = /^([ \t]*)(?:async\s+)?(for|while)\b(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p.bare))) {
    const start = m.index + m[1].length;
    const line = lineOf(p, start);
    const header = p.code.slice(start, (p.lineStarts[line] ?? p.code.length + 1) - 1).trim();
    const end = blockEnd(p, line);
    let kind: LoopKind = "other";
    let vars: string[] = [];
    let smallLiteral = false;
    if (m[2] === "for") {
      const f = /^(?:async\s+)?for\s+(.+?)\s+in\s+(.+?):?\s*$/.exec(header);
      if (f) {
        vars = identList(f[1]);
        const iter = f[2].trim();
        const range = /^range\(\s*(\d+)\s*\)$/.exec(iter);
        if (range && (Number(range[1]) <= 10 || vars.some((v) => RETRY_VAR.test(v)))) kind = "retry";
        else if (/^range\(\s*[\w.]*(retr|attempt|tries)/i.test(iter) || vars.some((v) => /^(attempt|retry|retries|tries)$/i.test(v))) kind = "retry";
        else if (/^(\w+\.)*(stream|events|response|resp|completion|chunks?)\b/i.test(iter) && !/s\b/.test(iter.split(".").pop() ?? "")) kind = "stream";
        else kind = "collection";
        smallLiteral = /^[\[(]/.test(iter) && countTopLevel(iter.replace(/^\(/, "[").replace(/\)$/, "]")) <= 3;
      }
    } else {
      const cond = header.replace(/^while\s*/, "").replace(/:\s*$/, "").trim();
      if (/^(True|1)$/.test(cond)) kind = "infinite";
      else if (RETRY_BOUND.test(cond)) kind = "retry";
    }
    loops.push({ kind, start, end, header: header.slice(0, 120), vars, smallLiteral, line });
  }
  const comp = /[\[({][^\[\](){}]*?\bfor\s+([\w, ()]+?)\s+in\s+/g;
  while ((m = comp.exec(p.bare))) {
    const lineStart = p.lineStarts[lineOf(p, m.index) - 1];
    const lineText = p.bare.slice(lineStart, m.index);
    if (/^\s*(async\s+)?for\b/.test(lineText)) continue;
    const close = matchClose(p.bare, m.index);
    loops.push({
      kind: "collection",
      start: m.index,
      end: close,
      header: p.code.slice(m.index, Math.min(close + 1, m.index + 120)),
      vars: identList(m[1]),
      smallLiteral: false,
      line: lineOf(p, m.index),
    });
    comp.lastIndex = m.index + 1;
  }
  return loops;
}

const JS_NOT_FN = new Set(["if", "for", "while", "switch", "catch", "function", "return", "with", "else", "do", "try", "constructor"]);

export function findFunctions(p: Parsed): Fn[] {
  const fns: Fn[] = [];
  if (p.lang === "py") {
    const re = /^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(p.bare))) {
      const start = m.index + m[1].length;
      const line = lineOf(p, start);
      fns.push({ name: m[2], start, end: blockEnd(p, line), line });
    }
    return fns;
  }
  const b = p.bare;
  const patterns: RegExp[] = [
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b[^(]*\(|(?:\([^()]*(?:\([^()]*\)[^()]*)*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?=>)/g,
    /^[ \t]*(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{;]+)?\{/gm,
    /\b([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?(?:function\b[^(]*\(|\([^()]*\)\s*=>)/g,
  ];
  const seen = new Set<number>();
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(b))) {
      const name = m[1];
      if (JS_NOT_FN.has(name)) continue;
      const brace = b.indexOf("{", m.index + m[0].length - 1);
      const arrowIdx = b.indexOf("=>", m.index);
      let end: number;
      if (arrowIdx !== -1 && arrowIdx < m.index + m[0].length + 2 && arrowIdx < brace) {
        let k = arrowIdx + 2;
        while (k < b.length && /\s/.test(b[k])) k++;
        end = b[k] === "{" ? matchClose(b, k) : statementEnd(b, k);
      } else {
        if (brace === -1) continue;
        end = matchClose(b, brace);
      }
      const start = m.index + (m[0].length - m[0].trimStart().length);
      if (seen.has(start)) continue;
      seen.add(start);
      fns.push({ name, start, end, line: lineOf(p, start) });
    }
  }
  return fns;
}

export function innermost<T extends { start: number; end: number }>(items: T[], offset: number): T | undefined {
  let best: T | undefined;
  for (const it of items) {
    if (it.start <= offset && offset <= it.end && (!best || it.end - it.start < best.end - best.start)) best = it;
  }
  return best;
}

export function enclosing<T extends { start: number; end: number }>(items: T[], offset: number): T[] {
  return items.filter((it) => it.start <= offset && offset <= it.end).sort((a, b) => a.end - a.start - (b.end - b.start));
}

const LLM_HOSTS = /(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|openrouter\.ai|api\.groq\.com|api\.mistral\.ai|api\.together\.xyz|api\.deepseek\.com|api\.cohere\.(ai|com)|api\.fireworks\.ai|api\.perplexity\.ai|openai\.azure\.com)/;

interface SiteRule {
  re: RegExp;
  kind: CallKind;
  provider: Provider;
  api: string;
  needs?: RegExp;
  needsArgs?: RegExp;
}

const SITE_RULES: SiteRule[] = [
  { re: /\.messages\.(?:create|stream)\s*\(/g, kind: "chat", provider: "anthropic", api: "messages.create", needs: /anthropic/i, needsArgs: /\b(model|max_tokens|maxTokens)\b/ },
  { re: /\.chat\.completions\.(?:create|parse|stream)\s*\(/g, kind: "chat", provider: "openai", api: "chat.completions.create" },
  { re: /\bChatCompletion\.a?create\s*\(/g, kind: "chat", provider: "openai", api: "ChatCompletion.create" },
  { re: /\.responses\.(?:create|parse|stream)\s*\(/g, kind: "chat", provider: "openai", api: "responses.create", needs: /openai/i },
  { re: /(?<!chat)\.completions\.create\s*\(/g, kind: "chat", provider: "openai", api: "completions.create", needs: /openai/i },
  { re: /\.embeddings\.create\s*\(/g, kind: "embed", provider: "openai", api: "embeddings.create" },
  { re: /\bEmbedding\.a?create\s*\(/g, kind: "embed", provider: "openai", api: "Embedding.create", needs: /openai/ },
  { re: /\blitellm\.a?completion\s*\(/g, kind: "chat", provider: "unknown", api: "litellm.completion" },
  { re: /\blitellm\.a?embedding\s*\(/g, kind: "embed", provider: "unknown", api: "litellm.embedding" },
  { re: /\.(?:generate_content(?:_async)?|generateContent(?:Stream)?)\s*\(/g, kind: "chat", provider: "google", api: "generate_content" },
  { re: /\.(?:embed_content|embedContent)\s*\(/g, kind: "embed", provider: "google", api: "embed_content" },
  { re: /\b(?:generateText|streamText|generateObject|streamObject)\s*\(/g, kind: "chat", provider: "unknown", api: "ai-sdk", needs: /from\s+["']ai["']|require\(\s*["']ai["']\s*\)/ },
  { re: /(?<![\w.])embed\s*\(/g, kind: "embed", provider: "unknown", api: "ai-sdk embed", needs: /from\s+["']ai["']/ },
  { re: /\b(?:llm|chat|model|chat_model|chatModel|chain|agent_llm)\.(?:invoke|ainvoke|predict|apredict)\s*\(/g, kind: "chat", provider: "unknown", api: "langchain invoke", needs: /langchain/i },
  { re: /\.(?:embed_query|embedQuery|aembed_query)\s*\(/g, kind: "embed", provider: "unknown", api: "langchain embed_query", needs: /langchain|embeddings/i },
  { re: /\.(?:invoke_model|converse)\s*\(|new\s+(?:InvokeModelCommand|ConverseCommand)\s*\(/g, kind: "chat", provider: "anthropic", api: "bedrock", needs: /bedrock/i },
];

const HTTP_RE_JS = /(?<![\w.$])(?:fetch|axios(?:\.(?:get|post|put|patch|request))?|got(?:\.(?:get|post))?|ky(?:\.(?:get|post))?)\s*\(/g;
const HTTP_RE_PY = /\b(?:requests|httpx|session|client|aiohttp_session|http)\.(?:get|post|put|patch|request)\s*\(|\burlopen\s*\(/g;

export function findSites(p: Parsed, consts: Map<string, StrConst>): { llm: Site[]; http: Site[] } {
  const llm: Site[] = [];
  const http: Site[] = [];
  const b = p.bare;
  for (const rule of SITE_RULES) {
    if (rule.needs && !rule.needs.test(p.code)) continue;
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(b))) {
      const open = m.index + m[0].length - 1;
      const close = matchClose(b, open);
      const args = p.code.slice(open + 1, close);
      if (rule.needsArgs && !rule.needsArgs.test(args) && !/^\s*[\w$.]+\s*$/.test(args) && !/\.\.\.|\*\*/.test(args)) continue;
      let provider = rule.provider;
      if (rule.api === "bedrock" && !/anthropic|claude/i.test(p.code)) provider = "other";
      llm.push({ kind: rule.kind, provider, api: rule.api, start: m.index, argsStart: open + 1, argsEnd: close, args, line: lineOf(p, m.index), endLine: lineOf(p, close) });
    }
  }
  const httpRe = p.lang === "js" ? HTTP_RE_JS : HTTP_RE_PY;
  httpRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = httpRe.exec(b))) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(b, open);
    const args = p.code.slice(open + 1, close);
    if (/^\s*$/.test(args)) continue;
    if (p.lang === "py" && /^(client|session|http)\./.test(m[0]) && !/https?:|url|endpoint|path/i.test(args)) continue;
    const firstArg = args.split(",")[0];
    const idents = firstArg.match(/[A-Za-z_$][\w$]*/g) ?? [];
    const hostHit = LLM_HOSTS.test(firstArg) || idents.some((id) => LLM_HOSTS.test(consts.get(id)?.value ?? ""));
    const site: Site = { kind: "http", provider: "unknown", api: m[0].replace(/\s*\($/, ""), start: m.index, argsStart: open + 1, argsEnd: close, args, line: lineOf(p, m.index), endLine: lineOf(p, close) };
    if (hostHit) {
      const host = LLM_HOSTS.exec(firstArg)?.[1] ?? idents.map((id) => LLM_HOSTS.exec(consts.get(id)?.value ?? "")?.[1]).find(Boolean) ?? "";
      site.kind = /embed/i.test(firstArg + idents.map((id) => consts.get(id)?.value ?? "").join(" ")) ? "embed" : "chat";
      site.provider = /anthropic/.test(host) ? "anthropic" : /openai/.test(host) ? "openai" : /googleapis/.test(host) ? "google" : "other";
      site.api = `rest ${host}`;
      llm.push(site);
    } else {
      http.push(site);
    }
  }
  llm.sort((a, b2) => a.start - b2.start);
  return { llm: dedupeSites(llm), http };
}

function dedupeSites(sites: Site[]): Site[] {
  const out: Site[] = [];
  for (const s of sites) if (!out.some((o) => o.start === s.start || (s.start > o.start && s.start < o.argsStart))) out.push(s);
  return out;
}

export function findStringConsts(p: Parsed): Map<string, StrConst> {
  const map = new Map<string, StrConst>();
  const re =
    p.lang === "js"
      ? /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*(?=["'`])/g
      : /^[ \t]*(?:self\.)?([A-Za-z_]\w*)\s*(?::\s*str\s*)?=\s*(?=[rRfFbBuU]{0,2}["'])/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p.bare))) {
    let i = m.index + m[0].length;
    while (/[rRfFbBuU]/.test(p.code[i])) i++;
    const q = p.code[i];
    const triple = p.lang === "py" && p.code.slice(i, i + 3) === q.repeat(3);
    const qlen = triple ? 3 : 1;
    let j = i + qlen;
    while (j < p.code.length) {
      if (p.code[j] === "\\") {
        j += 2;
        continue;
      }
      if (p.code.startsWith(q.repeat(qlen), j)) break;
      if (q !== "`" && !triple && p.code[j] === "\n") break;
      j++;
    }
    const value = p.code.slice(i + qlen, j);
    const prefix = p.code.slice(m.index + m[0].length, i);
    const dynamic = q === "`" ? /\$\{/.test(value) : /f/i.test(prefix) && /\{[^}]+\}/.test(value);
    if (!map.has(m[1]) || value.length > (map.get(m[1])?.value.length ?? 0)) map.set(m[1], { value, dynamic, line: lineOf(p, m.index) });
  }
  return map;
}

export function importsName(p: Parsed, name: string): boolean {
  const esc = name.replace(/[$]/g, "\\$");
  const re =
    p.lang === "js"
      ? new RegExp(`(import\\s+[^;]*\\b${esc}\\b[^;]*from|\\b${esc}\\b[^;=]*=\\s*require\\(|\\{[^}]*\\b${esc}\\b[^}]*\\}\\s*=\\s*require\\()`)
      : new RegExp(`(from\\s+[\\w.]+\\s+import\\s+[^\\n]*\\b${esc}\\b|import\\s+[\\w.]*\\b${esc}\\b)`);
  return re.test(p.code);
}

export function lineRangeText(p: Parsed, startLine: number, endLine: number): string {
  return p.lines.slice(startLine - 1, endLine).join("\n");
}
