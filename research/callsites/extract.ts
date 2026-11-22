import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "../../lib/analyze/source";
import { findSites, findStringConsts } from "../../lib/analyze/structure";
import { isCandidate, isTest, looksMinified } from "../../lib/source/filter";

const MODEL_RE = /^(gpt-[\w.\-]+|o[1-9](?:-[\w\-]+)?|claude-[\w.\-]+|gemini-[\w.\-]+|chatgpt-[\w.\-]+)$/;
const PLACEHOLDER_RE = /\{\{?\s*([a-zA-Z_][\w]*)\s*\}?\}/g;
const PROMPTISH = /\b(you are|answer|output|return|extract|classify|summari[sz]e|judge|score|respond|instructions?|context|query|question)\b/i;

interface ModelDefault { file: string; line: number; name: string; model: string; text: string }
interface Template { file: string; line: number; name: string; chars: number; placeholders: string[]; head: string; value: string }
interface CallSite { file: string; line: number; api: string; provider: string; kind: string; literalModel?: string }

function walk(dir: string, root: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, root, out);
    else {
      const rel = relative(root, full);
      if (isCandidate(rel) && !isTest(rel) && st.size < 400_000) out.push(rel);
    }
  }
}

function extract(root: string) {
  const files: string[] = [];
  walk(root, root, files);
  const sites: CallSite[] = [];
  const defaults: ModelDefault[] = [];
  const templates: Template[] = [];
  for (const rel of files) {
    const raw = readFileSync(join(root, rel), "utf8");
    if (looksMinified(raw)) continue;
    const p = parse(rel, raw);
    if (!p) continue;
    const consts = findStringConsts(p);
    for (const s of findSites(p, consts).llm) {
      const lit = /\bmodel\s*[=:]\s*["'`]([^"'`]+)["'`]/.exec(s.args)?.[1];
      sites.push({ file: rel, line: s.line, api: s.api, provider: s.provider, kind: s.kind, literalModel: lit });
    }
    const assign = /([A-Za-z_$][\w$]*)\s*(?::\s*[\w\[\]|. ]+)?\s*=\s*(?:Field\(\s*(?:default\s*=\s*)?)?["'`]([^"'`\n]{2,60})["'`]/g;
    p.lines.forEach((line, i) => {
      assign.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = assign.exec(line))) {
        if (MODEL_RE.test(m[2]) && /model/i.test(m[1] + line)) defaults.push({ file: rel, line: i + 1, name: m[1], model: m[2], text: line.trim().slice(0, 200) });
      }
    });
    for (const [name, c] of consts) {
      if (c.value.length < 300 || !PROMPTISH.test(c.value)) continue;
      const ph = [...new Set([...c.value.matchAll(PLACEHOLDER_RE)].map((x) => x[1]))];
      if (!ph.length && !/you are|instructions/i.test(c.value)) continue;
      templates.push({ file: rel, line: c.line, name, chars: c.value.length, placeholders: ph.slice(0, 12), head: c.value.slice(0, 240), value: c.value });
    }
  }
  return { filesScanned: files.length, callSites: sites, modelDefaults: defaults, promptTemplates: templates };
}

const [root, outPath, label] = process.argv.slice(2);
const res = extract(root);
writeFileSync(outPath, JSON.stringify({ repo: label, ...res }, null, 1));
console.log(`${label}: ${res.filesScanned} files, ${res.callSites.length} llm call sites, ${res.modelDefaults.length} model defaults, ${res.promptTemplates.length} prompt templates`);
