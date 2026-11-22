import { describe, expect, test } from "vitest";
import { findPrice, normalizeModel, PRICES } from "../lib/pricing";
import { estimate, totals, type Assumptions } from "../lib/savings";
import type { Finding } from "../lib/types";

const a: Assumptions = { callsPerDay: 1000, inputTokens: 1000, outputTokens: 200, model: "claude-sonnet-5-5", useDetectedModel: true };

const finding = (over: Partial<Finding>): Finding => ({
  id: "x",
  pattern: "n-plus-one",
  severity: "high",
  confidence: "high",
  file: "a.ts",
  startLine: 1,
  endLine: 2,
  snippet: [],
  title: "t",
  evidence: [],
  callKind: "chat",
  provider: "anthropic",
  siteKey: "a.ts:1",
  ...over,
});

describe("pricing table", () => {
  test("normalizes dated and prefixed ids", () => {
    expect(normalizeModel("gpt-4o-2024-08-06")).toBe("gpt-4o");
    expect(normalizeModel("openai/gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(findPrice("claude-haiku-4-5-20251001")?.id).toBe("claude-haiku-4-5");
    expect(findPrice("gpt-4o-mini")?.id).toBe("gpt-4o-mini");
  });

  test("unknown models have no price", () => {
    expect(findPrice("claude-3-5-sonnet-20241022")).toBeUndefined();
    expect(findPrice("gpt-3.5-turbo")).toBeUndefined();
  });

  test("ids are unique", () => {
    expect(new Set(PRICES.map((p) => p.id)).size).toBe(PRICES.length);
  });
});

describe("estimates", () => {
  test("input share pattern uses the documented formula", () => {
    const e = estimate(finding({ model: "claude-sonnet-5-5" }), a);
    const input = (1000 * 2 * 1000 * 30) / 1e6;
    expect(e.priced).toBe(true);
    expect(e.low).toBeCloseTo(input * 0.3);
    expect(e.high).toBeCloseTo(input * 0.6);
  });

  test("model swap uses the real price gap", () => {
    const e = estimate(finding({ pattern: "expensive-model", model: "claude-opus-5-5", suggestedModel: "claude-haiku-5-5" }), a);
    const opus = ((1000 * 4 + 200 * 20) / 1e6) * 1000 * 30;
    const haiku = ((1000 * 0.1 + 200 * 0.5) / 1e6) * 1000 * 30;
    expect(e.high).toBeCloseTo(opus - haiku);
    expect(e.low).toBeCloseTo((opus - haiku) / 2);
  });

  test("batch is half of the call cost", () => {
    const e = estimate(finding({ pattern: "batch-api-candidate", model: "gpt-4o" }), a);
    const cost = ((1000 * 2.5 + 200 * 10) / 1e6) * 1000 * 30;
    expect(e.low).toBeCloseTo(cost / 2);
  });

  test("unpriced model says so instead of guessing", () => {
    const e = estimate(finding({ model: "claude-3-opus-20240229" }), a);
    expect(e.priced).toBe(false);
    expect(e.reason).toContain("pricing not available");
  });

  test("unticking detected model prices with the chosen model", () => {
    const e = estimate(finding({ model: "claude-3-opus-20240229" }), { ...a, useDetectedModel: false });
    expect(e.priced).toBe(true);
    expect(e.model).toBe("claude-sonnet-5-5");
  });

  test("http findings are never priced", () => {
    expect(estimate(finding({ pattern: "duplicate-fetch", callKind: "http" }), a).priced).toBe(false);
  });

  test("totals count each call site once and skip low confidence", () => {
    const f1 = finding({ id: "1", model: "claude-sonnet-5-5" });
    const f2 = finding({ id: "2", pattern: "history-resend", model: "claude-sonnet-5-5" });
    const f3 = finding({ id: "3", siteKey: "b.ts:1", confidence: "low", model: "claude-sonnet-5-5" });
    const t = totals([f1, f2, f3], a);
    expect(t.high).toBeCloseTo(estimate(f2, a).high);
    expect(t.counted).toBe(2);
  });

  test("assumptions recalc linearly with calls per day", () => {
    const f = finding({ model: "claude-sonnet-5-5" });
    expect(estimate(f, { ...a, callsPerDay: 2000 }).high).toBeCloseTo(estimate(f, a).high * 2);
  });
});
