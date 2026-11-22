import type { Lang } from "../types";

export interface Parsed {
  path: string;
  lang: Lang;
  raw: string;
  code: string;
  bare: string;
  lineStarts: number[];
  lines: string[];
}

export function langOf(path: string): Lang | null {
  if (/\.(m|c)?(j|t)sx?$/.test(path)) return "js";
  if (/\.py$/.test(path)) return "py";
  return null;
}

export function parse(path: string, raw: string): Parsed | null {
  const lang = langOf(path);
  if (!lang) return null;
  const text = raw.replace(/\r\n?/g, "\n");
  const { code, bare } = lang === "js" ? stripJs(text) : stripPy(text);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  return { path, lang, raw: text, code, bare, lineStarts, lines: text.split("\n") };
}

export function lineOf(p: Parsed, offset: number): number {
  let lo = 0;
  let hi = p.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p.lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function blank(ch: string) {
  return ch === "\n" ? "\n" : " ";
}

const REGEX_PREV = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", ""]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "yield", "await", "in", "of"]);

function stripJs(src: string): { code: string; bare: string } {
  const code: string[] = [];
  const bare: string[] = [];
  const n = src.length;
  let i = 0;
  const tplStack: number[] = [];
  let braceDepth = 0;
  let lastSig = "";

  const pushBoth = (c: string, b: string) => {
    code.push(c);
    bare.push(b);
  };

  const readQuoted = (q: string) => {
    pushBoth(src[i], src[i]);
    i++;
    while (i < n) {
      const c = src[i];
      if (c === "\\" && i + 1 < n) {
        pushBoth(c, " ");
        pushBoth(src[i + 1], blank(src[i + 1]));
        i += 2;
        continue;
      }
      if (c === q || c === "\n") {
        pushBoth(c, c);
        i++;
        return;
      }
      pushBoth(c, blank(c));
      i++;
    }
  };

  const readTemplate = () => {
    while (i < n) {
      const c = src[i];
      if (c === "\\" && i + 1 < n) {
        pushBoth(c, " ");
        pushBoth(src[i + 1], blank(src[i + 1]));
        i += 2;
        continue;
      }
      if (c === "`") {
        pushBoth(c, c);
        i++;
        return;
      }
      if (c === "$" && src[i + 1] === "{") {
        pushBoth("$", " ");
        pushBoth("{", " ");
        i += 2;
        tplStack.push(braceDepth);
        braceDepth++;
        return "interp";
      }
      pushBoth(c, blank(c));
      i++;
    }
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") {
        pushBoth(" ", " ");
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        pushBoth(blank(src[i]), blank(src[i]));
        i++;
      }
      if (i < n) {
        pushBoth(" ", " ");
        pushBoth(" ", " ");
        i += 2;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      readQuoted(c);
      lastSig = "a";
      continue;
    }
    if (c === "`") {
      pushBoth(c, c);
      i++;
      readTemplate();
      lastSig = "a";
      continue;
    }
    if (c === "/" && REGEX_PREV.has(lastSig)) {
      let j = i + 1;
      let inClass = false;
      let ok = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) {
          ok = true;
          break;
        }
        j++;
      }
      if (ok) {
        pushBoth("/", "/");
        for (let k = i + 1; k < j; k++) pushBoth(src[k], " ");
        pushBoth("/", "/");
        i = j + 1;
        lastSig = "a";
        continue;
      }
    }
    if (c === "{") braceDepth++;
    if (c === "}") {
      braceDepth--;
      if (tplStack.length && tplStack[tplStack.length - 1] === braceDepth) {
        tplStack.pop();
        pushBoth(c, " ");
        i++;
        readTemplate();
        lastSig = "a";
        continue;
      }
    }
    pushBoth(c, c);
    if (!/\s/.test(c)) lastSig = /[\w$]/.test(c) ? "a" : c;
    if (lastSig === "a" && !/[\w$]/.test(src[i + 1] ?? "")) {
      const m = /([\w$]+)$/.exec(src.slice(Math.max(0, i - 10), i + 1));
      if (m && REGEX_KEYWORDS.has(m[1])) lastSig = "(";
    }
    i++;
  }
  return { code: code.join(""), bare: bare.join("") };
}

function stripPy(src: string): { code: string; bare: string } {
  const code: string[] = [];
  const bare: string[] = [];
  const n = src.length;
  let i = 0;
  const pushBoth = (c: string, b: string) => {
    code.push(c);
    bare.push(b);
  };
  while (i < n) {
    const c = src[i];
    if (c === "#") {
      while (i < n && src[i] !== "\n") {
        pushBoth(" ", " ");
        i++;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      const triple = src.slice(i, i + 3) === c.repeat(3);
      const q = triple ? c.repeat(3) : c;
      for (let k = 0; k < q.length; k++) pushBoth(c, c);
      i += q.length;
      while (i < n) {
        if (src[i] === "\\" && i + 1 < n) {
          pushBoth(src[i], " ");
          pushBoth(src[i + 1], blank(src[i + 1]));
          i += 2;
          continue;
        }
        if (src.startsWith(q, i)) {
          for (let k = 0; k < q.length; k++) pushBoth(c, c);
          i += q.length;
          break;
        }
        if (!triple && src[i] === "\n") break;
        pushBoth(src[i], blank(src[i]));
        i++;
      }
      continue;
    }
    pushBoth(c, c);
    i++;
  }
  return { code: code.join(""), bare: bare.join("") };
}

export function matchClose(bare: string, openIdx: number): number {
  const open = bare[openIdx];
  const close = open === "(" ? ")" : open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = openIdx; i < bare.length; i++) {
    const c = bare[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return bare.length - 1;
}

export function stringText(p: Parsed, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end && i < p.code.length; i++) {
    if (p.code[i] !== p.bare[i]) out += p.code[i];
    else if (out.length && out[out.length - 1] !== " ") out += " ";
  }
  return out;
}

export function indentOf(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].replace(/\t/g, "    ").length : 0;
}
