import { PATTERNS } from "../patterns";
import { findPrice } from "../pricing";
import { defaultAssumptions, estimate, monthlyCost, pickPrice, totals, type Assumptions } from "../savings";
import type { Finding, Level, ScanReport } from "../types";

export type OldSeverity = "critical" | "warning" | "info";

export interface Verdict {
  id: string;
  verdict: "confirmed" | "rejected" | "unsure";
  reason: string;
}

export interface Flag {
  id: string;
  pattern: string;
  severity: OldSeverity;
  confidence: Level;
  file: string;
  line: number;
  endLine: number;
  title: string;
  description: string;
  codeSnippet: string;
  snippet: Finding["snippet"];
  impact: string;
  fix: string;
  before: string;
  after: string;
  verdict?: Verdict;
  finding: Finding;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface OldReport {
  flags: Flag[];
  summary: { filesScanned: number; filesAnalyzed: number; critical: number; warning: number; info: number; totalFlags: number };
  tokenUsage: { triage: Usage; deepScan: Usage; synthesis: Usage };
  overallAssessment: string;
  topRecommendation?: string;
  deepReadSummary?: string;
  deepReadError?: string;
  deepReadModel?: string;
  raw: ScanReport;
}

const cap = (t: string) => {
  if (!t) return t;
  const clean = t.replace(/`/g, "'");
  return /^[a-z]+[\w.]*[-\d]/.test(clean.split(" ")[0]) ? clean : clean[0].toUpperCase() + clean.slice(1);
};

const SEV: Record<Level, OldSeverity> = { high: "critical", medium: "warning", low: "info" };
const zero = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });

export function toFlag(f: Finding): Flag {
  const meta = PATTERNS[f.pattern];
  const lang = f.file.endsWith(".py") ? "py" : "js";
  return {
    id: f.id,
    pattern: f.pattern,
    severity: SEV[f.severity] ?? "info",
    confidence: f.confidence,
    file: f.file,
    line: f.startLine,
    endLine: f.endLine,
    title: cap(f.title),
    description: cap(meta ? meta.why : f.title),
    codeSnippet: (f.snippet ?? []).map((l) => (l.n < 0 ? "..." : l.text)).join("\n"),
    snippet: f.snippet ?? [],
    impact: cap((f.evidence ?? []).join(". ")),
    fix: meta ? `${cap(meta.fix)}${f.suggestedModel ? ` Try ${f.suggestedModel}.` : ""}` : "",
    before: meta?.example[lang].before ?? "",
    after: meta?.example[lang].after ?? "",
    finding: f,
  };
}

export function toOldReport(r: ScanReport): OldReport {
  const flags = r.findings.map(toFlag);
  const count = (s: OldSeverity) => flags.filter((f) => f.severity === s).length;
  return {
    flags,
    summary: { filesScanned: r.stats.filesInSource, filesAnalyzed: r.stats.filesScanned, critical: count("critical"), warning: count("warning"), info: count("info"), totalFlags: flags.length },
    tokenUsage: { triage: zero(), deepScan: zero(), synthesis: zero() },
    overallAssessment: assessment(r),
    topRecommendation: r.findings[0] ? cap(PATTERNS[r.findings[0].pattern]?.fix ?? "") || undefined : undefined,
    raw: r,
  };
}

function assessment(r: ScanReport): string {
  const n = r.findings.length;
  const sites = r.stats.llmCallSites;
  const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  if (!sites) return `No LLM API calls were found in ${plural(r.stats.filesScanned, "source file")}${r.stats.httpCallSites ? `, so only ${plural(r.stats.httpCallSites, "generic HTTP call")} were checked` : ""}.`;
  if (!n) return `No API inefficiency patterns were found across ${plural(sites, "LLM call site")}.`;
  const byPattern = new Map<string, number>();
  for (const f of r.findings) byPattern.set(f.pattern, (byPattern.get(f.pattern) ?? 0) + 1);
  const top = [...byPattern.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p, c]) => `${PATTERNS[p as keyof typeof PATTERNS]?.name ?? p} (${c})`);
  const crit = r.findings.filter((f) => f.severity === "high").length;
  return `This codebase has ${plural(n, "API efficiency issue")} across ${plural(sites, "LLM call site")}. ${crit ? `${plural(crit, "critical pattern")} should be addressed first. ` : ""}Most common: ${top.join(", ")}.`;
}

export function savingsLine(report: OldReport, a: Assumptions): string {
  if (!report.raw.stats.llmCallSites || !report.raw.findings.length) return "";
  const t = totals(report.raw.findings, a);
  return `Estimated monthly waste at the simulator assumptions below: $${fmtMoney(t.low)} to $${fmtMoney(t.high)} (high and medium confidence flags, each call site counted once).`;
}

export interface FlagEstimate {
  priced: boolean;
  beforeCost: number;
  afterCost: number;
  savingsPercent: number;
  lowPercent: number;
  monthlyLow: number;
  monthlyHigh: number;
  monthlyBase: number;
  explanation: string;
  modelLabel: string;
  formula: string;
}

export function estimateFlag(flag: Flag, a: Assumptions): FlagEstimate {
  const e = estimate(flag.finding, a);
  const price = pickPrice(flag.finding, a);
  const why = PATTERNS[flag.finding.pattern]?.savingsWhy ?? "";
  if (!e.priced || !price) {
    return {
      priced: false,
      beforeCost: 0,
      afterCost: 0,
      savingsPercent: 0,
      lowPercent: 0,
      monthlyLow: 0,
      monthlyHigh: 0,
      monthlyBase: 0,
      explanation: e.requestsNote ? `Counted in requests, not dollars: ${e.requestsNote}.` : e.reason ? `${e.reason[0].toUpperCase()}${e.reason.slice(1)}.` : "Not priced.",
      modelLabel: price?.id ?? flag.finding.model ?? a.model,
      formula: e.formula,
    };
  }
  const perCall = monthlyCost(price, a).perCall;
  const base = e.baseMonthly || 1;
  const highPct = Math.round((e.high / base) * 100);
  const lowPct = Math.round((e.low / base) * 100);
  return {
    priced: true,
    beforeCost: perCall,
    afterCost: perCall * (1 - e.high / base),
    savingsPercent: highPct,
    lowPercent: lowPct,
    monthlyLow: e.low,
    monthlyHigh: e.high,
    monthlyBase: e.baseMonthly,
    explanation: `Saves ${lowPct === highPct ? `${highPct}%` : `${lowPct}-${highPct}%`} of this call's cost. ${why}`,
    modelLabel: price.id,
    formula: e.formula,
  };
}

export function deepReadCost(u: Usage, model: string | undefined): number {
  const p = findPrice(model);
  if (!p) return 0;
  const read = p.cachedInput ?? p.input * 0.1;
  return ((Math.max(0, u.input) * p.input + u.output * p.output + u.cacheRead * read + u.cacheCreation * p.input * 1.25) / 1e6);
}

export function fmtMoney(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(3);
  return n.toFixed(4);
}

export { defaultAssumptions, totals };
export type { Assumptions };
