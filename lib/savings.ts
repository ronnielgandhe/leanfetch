import { PATTERNS } from "./patterns";
import { findPrice, type Price } from "./pricing";
import type { Finding, ScanReport } from "./types";

export interface Assumptions {
  callsPerDay: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  useDetectedModel: boolean;
}

export interface Estimate {
  priced: boolean;
  model?: string;
  baseMonthly: number;
  low: number;
  high: number;
  requestsNote?: string;
  formula: string;
  reason?: string;
}

const DAYS = 30;

export function defaultAssumptions(report: Pick<ScanReport, "models">): Assumptions {
  const priced = report.models.map((m) => findPrice(m)).find((p) => p && p.kind !== "embed");
  return { callsPerDay: 1000, inputTokens: 1500, outputTokens: 300, model: priced?.id ?? "claude-sonnet-5-5", useDetectedModel: true };
}

export function monthlyCost(price: Price, a: Pick<Assumptions, "callsPerDay" | "inputTokens" | "outputTokens">) {
  const perCall = (a.inputTokens * price.input + a.outputTokens * price.output) / 1e6;
  return { perCall, monthly: perCall * a.callsPerDay * DAYS, input: (a.inputTokens * price.input * a.callsPerDay * DAYS) / 1e6, output: (a.outputTokens * price.output * a.callsPerDay * DAYS) / 1e6 };
}

export function pickPrice(f: Finding, a: Assumptions): Price | undefined {
  if (a.useDetectedModel && f.model) {
    const p = findPrice(f.model);
    if (p) return p;
    return undefined;
  }
  return findPrice(a.model);
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US")}`;

export function estimate(f: Finding, a: Assumptions): Estimate {
  const meta = PATTERNS[f.pattern];
  const sm = meta.savings;
  if (sm.type === "requests" || f.callKind === "http") {
    const note = sm.type === "requests" ? sm.note : "requests saved";
    return { priced: false, baseMonthly: 0, low: 0, high: 0, requestsNote: note, formula: "counted in requests, not dollars", reason: f.callKind === "http" ? "generic api, no shared price list" : meta.savingsWhy };
  }
  const price = pickPrice(f, a);
  if (!price) {
    return { priced: false, baseMonthly: 0, low: 0, high: 0, formula: "", reason: f.model && a.useDetectedModel ? `pricing not available for ${f.model}` : `pricing not available for ${a.model}` };
  }
  const embed = price.kind === "embed" || f.callKind === "embed";
  const tokens = { callsPerDay: a.callsPerDay, inputTokens: a.inputTokens, outputTokens: embed ? 0 : a.outputTokens };
  const cost = monthlyCost(price, tokens);
  const base = `cost = ${a.callsPerDay.toLocaleString("en-US")} calls/day x 30 x (${a.inputTokens} in x $${price.input} + ${tokens.outputTokens} out x $${price.output}) / 1M = ${usd(cost.monthly)}/mo on ${price.id}`;
  switch (sm.type) {
    case "input":
      return { priced: true, model: price.id, baseMonthly: cost.monthly, low: cost.input * sm.low, high: cost.input * sm.high, formula: `${base}; saved = input share ${usd(cost.input)} x ${sm.low * 100}-${sm.high * 100}%` };
    case "output":
      return { priced: true, model: price.id, baseMonthly: cost.monthly, low: cost.output * sm.low, high: cost.output * sm.high, formula: `${base}; saved = output share ${usd(cost.output)} x ${sm.low * 100}-${sm.high * 100}%` };
    case "total":
      return { priced: true, model: price.id, baseMonthly: cost.monthly, low: cost.monthly * sm.low, high: cost.monthly * sm.high, formula: `${base}; saved = ${usd(cost.monthly)} x ${sm.low * 100}-${sm.high * 100}%` };
    case "batch": {
      const mult = price.batchMultiplier;
      if (!mult) return { priced: false, baseMonthly: cost.monthly, low: 0, high: 0, formula: base, reason: `no published batch discount for ${price.id}` };
      const saved = cost.monthly * (1 - mult);
      return { priced: true, model: price.id, baseMonthly: cost.monthly, low: saved, high: saved, formula: `${base}; saved = ${usd(cost.monthly)} x ${(1 - mult) * 100}% batch discount` };
    }
    case "model-swap": {
      const alt = findPrice(f.suggestedModel);
      if (!alt) return { priced: false, baseMonthly: cost.monthly, low: 0, high: 0, formula: base, reason: `pricing not available for ${f.suggestedModel ?? "a cheaper model"}` };
      const altCost = monthlyCost(alt, tokens).monthly;
      const diff = Math.max(0, cost.monthly - altCost);
      return { priced: true, model: price.id, baseMonthly: cost.monthly, low: diff * 0.5, high: diff, formula: `${base}; same traffic on ${alt.id} = ${usd(altCost)}/mo; saved = ${usd(diff)} x 50-100% of calls moved` };
    }
    case "cache": {
      const promptTokens = f.promptTokens ?? a.inputTokens;
      const read = price.cachedInput ?? price.input * 0.1;
      const write = price.input * 0.25;
      const perCall = (hit: number) => (promptTokens * (hit * (price.input - read) - (1 - hit) * write)) / 1e6;
      const low = Math.max(0, perCall(0.5) * a.callsPerDay * DAYS);
      const high = Math.max(0, perCall(0.9) * a.callsPerDay * DAYS);
      return { priced: true, model: price.id, baseMonthly: cost.monthly, low, high, formula: `${base}; saved = ${promptTokens.toLocaleString("en-US")} prompt tokens x (hit x ($${price.input} - $${read} read) - miss x $${write.toFixed(2)} write premium) / 1M x calls, hit rate 50-90%` };
    }
  }
}

export interface Totals {
  low: number;
  high: number;
  pricedFindings: number;
  unpricedFindings: number;
  counted: number;
}

export function totals(findings: Finding[], a: Assumptions): Totals {
  const bySite = new Map<string, { low: number; high: number }>();
  let priced = 0;
  let unpriced = 0;
  let counted = 0;
  for (const f of findings) {
    const e = estimate(f, a);
    if (!e.priced) {
      unpriced++;
      continue;
    }
    priced++;
    if (f.confidence === "low") continue;
    counted++;
    const cur = bySite.get(f.siteKey);
    if (!cur || e.high > cur.high) bySite.set(f.siteKey, { low: e.low, high: e.high });
  }
  let low = 0;
  let high = 0;
  for (const v of bySite.values()) {
    low += v.low;
    high += v.high;
  }
  return { low, high, pricedFindings: priced, unpricedFindings: unpriced, counted };
}

export function money(n: number): string {
  if (n === 0) return "$0";
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 100) return `$${n.toFixed(0)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
