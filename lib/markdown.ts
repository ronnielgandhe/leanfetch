import { PATTERN_ORDER, PATTERNS } from "./patterns";
import { PRICING_AS_OF } from "./pricing";
import { estimate, money, totals, type Assumptions } from "./savings";
import type { ScanReport } from "./types";

export function sourceLabel(r: ScanReport): string {
  return r.source.kind === "github" ? `${r.source.owner}/${r.source.repo}@${r.source.ref}` : r.source.name;
}

export function toMarkdown(r: ScanReport, a: Assumptions, verdicts: Record<string, { verdict: string; reason: string }> = {}): string {
  const t = totals(r.findings, a);
  const out: string[] = [];
  out.push(`# leanfetch report: ${sourceLabel(r)}`);
  out.push("");
  out.push(`${r.stats.filesScanned} files scanned, ${r.stats.llmCallSites} llm call sites, ${r.stats.httpCallSites} http call sites, ${r.findings.length} findings.`);
  if (r.errors.length) out.push(`\n**incomplete scan:** ${r.errors.length} analysis steps failed (${r.errors.slice(0, 3).join("; ")}).`);
  for (const n of r.notes) out.push(`\n> ${n}`);
  out.push("");
  out.push(`**estimated monthly waste:** ${money(t.low)} to ${money(t.high)}`);
  out.push("");
  out.push(`assumptions: ${a.callsPerDay} calls/day per call site, ${a.inputTokens} input and ${a.outputTokens} output tokens per call, ${a.useDetectedModel ? "detected model where priced, otherwise " : ""}${a.model}. prices as of ${PRICING_AS_OF}. only high and medium confidence findings count toward the total, and each call site counts once.`);
  for (const id of PATTERN_ORDER) {
    const list = r.findings.filter((f) => f.pattern === id);
    if (!list.length) continue;
    const meta = PATTERNS[id];
    out.push("");
    out.push(`## ${meta.name} (${list.length})`);
    out.push("");
    out.push(meta.why);
    out.push("");
    out.push(`fix: ${meta.fix}`);
    for (const f of list) {
      const e = estimate(f, a);
      out.push("");
      out.push(`### ${f.title}`);
      out.push(`\`${f.file}:${f.startLine}${f.endLine !== f.startLine ? `-${f.endLine}` : ""}\` · severity ${f.severity} · confidence ${f.confidence}${f.model ? ` · ${f.model}` : ""}`);
      const v = verdicts[f.id];
      if (v) out.push(`\ndeep read: ${v.verdict}. ${v.reason}`);
      out.push("");
      for (const ev of f.evidence) out.push(`- ${ev}`);
      out.push("");
      out.push("```" + (f.file.endsWith(".py") ? "python" : "ts"));
      for (const l of f.snippet) out.push(l.n < 0 ? "..." : `${String(l.n).padStart(4)} ${l.hot ? ">" : " "} ${l.text}`);
      out.push("```");
      out.push("");
      out.push(e.priced ? `savings: ${money(e.low)} to ${money(e.high)} per month (${e.formula})` : `savings: ${e.requestsNote ?? e.reason ?? "not priced"}`);
    }
  }
  if (!r.findings.length) {
    out.push("");
    out.push(r.stats.llmCallSites ? "no wasteful patterns found in the llm call sites that were scanned." : "nothing to report: no llm api usage found.");
  }
  out.push("");
  out.push("made with leanfetch. static analysis only; estimates depend on the assumptions above.");
  return out.join("\n");
}
