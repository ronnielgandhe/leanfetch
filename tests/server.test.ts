import { describe, expect, test, vi } from "vitest";
import { buildRequest, buildUserContent, DEEP_READ, runDeepRead, sanitizeCandidates, SYSTEM_PROMPT } from "../lib/deepread";
import { getLimiter } from "../lib/ratelimit";

const cand = { id: "abc", pattern: "n-plus-one", file: "a.ts", startLine: 1, endLine: 3, title: "t", evidence: ["e"], code: "1: for (x of xs) await llm(x)" };

describe("deep read request", () => {
  test("uses a current model id, caches the system prompt and caps output", () => {
    const req = buildRequest(sanitizeCandidates([cand]));
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.model).not.toMatch(/\d{8}/);
    expect(req.max_tokens).toBe(DEEP_READ.maxTokens);
    const sys = req.system as { text: string; cache_control?: unknown }[];
    expect(sys[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sys[0].text).toBe(SYSTEM_PROMPT);
    expect(req.output_config?.format?.type).toBe("json_schema");
  });

  test("system prompt is long enough to cache (~512+ tokens)", () => {
    expect(SYSTEM_PROMPT.length / 4).toBeGreaterThan(600);
  });

  test("input is capped", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...cand, id: `id${i}`, code: "x".repeat(5000) }));
    const clean = sanitizeCandidates(many);
    expect(clean).toHaveLength(DEEP_READ.maxFindings);
    expect(clean[0].code.length).toBe(DEEP_READ.maxSnippetChars);
    expect(buildUserContent(clean).length).toBeLessThan(DEEP_READ.maxInputChars + 200);
  });

  test("drops malformed candidates", () => {
    expect(sanitizeCandidates([{ id: 1 }, { ...cand, pattern: "made-up" }, "x"])).toEqual([]);
  });

  test("parses a mocked response and keeps only known ids", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "claude-sonnet-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ summary: "one real issue.", verdicts: [{ id: "abc", verdict: "confirmed", reason: "loop over items" }, { id: "zzz", verdict: "rejected", reason: "?" }] }) }],
      usage: { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
    });
    const out = await runDeepRead(sanitizeCandidates([cand]), { beta: { messages: { create } } });
    expect(create).toHaveBeenCalledOnce();
    expect(out.verdicts).toEqual([{ id: "abc", verdict: "confirmed", reason: "loop over items" }]);
    expect(out.usage.cacheRead).toBe(800);
  });

  test("refusal and truncation surface as errors, not empty results", async () => {
    const refuse = vi.fn().mockResolvedValue({ stop_reason: "refusal", content: [], usage: {} });
    await expect(runDeepRead(sanitizeCandidates([cand]), { beta: { messages: { create: refuse } } })).rejects.toThrow(/declined/);
    const cut = vi.fn().mockResolvedValue({ stop_reason: "max_tokens", content: [], usage: {} });
    await expect(runDeepRead(sanitizeCandidates([cand]), { beta: { messages: { create: cut } } })).rejects.toThrow(/ran out/);
  });

  test("upstream errors do not leak their body", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("secret upstream body sk-ant-xxx"));
    await expect(runDeepRead(sanitizeCandidates([cand]), { beta: { messages: { create: boom } } })).rejects.toThrow("deep read failed upstream");
  });
});

describe("memory rate limiter", () => {
  test("blocks after the limit within the window", async () => {
    const l = getLimiter();
    const key = `t:${Math.random()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await l.hit(key, 3, 60)).ok);
    expect(results).toEqual([true, true, true, false]);
    expect((await l.peek(key, 3)).ok).toBe(false);
  });
});
