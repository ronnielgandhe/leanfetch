import { describe, expect, test } from "vitest";
import { analyze } from "../lib/analyze";
import type { Finding, PatternId } from "../lib/types";
import { loadDir } from "./load";

const run = (dir: string) => analyze(loadDir(`tests/fixtures/${dir}`));
const at = (fs: Finding[], pattern: PatternId, file: string) => fs.filter((f) => f.pattern === pattern && f.file === file);

describe("js fixtures", () => {
  const r = run("bad-js");

  test("counts call sites and models", () => {
    expect(r.stats.llmCallSites).toBe(5);
    expect(r.models).toContain("gpt-4o");
    expect(r.errors).toEqual([]);
  });

  test("n+1: direct call in for-of", () => {
    const f = at(r.findings, "n-plus-one", "reviews.ts");
    expect(f).toHaveLength(1);
    expect(f[0].confidence).toBe("high");
    expect(f[0].startLine).toBe(7);
  });

  test("n+1: through a wrapper defined in the same repo", () => {
    const f = at(r.findings, "n-plus-one", "agent.ts");
    expect(f).toHaveLength(1);
    expect(f[0].evidence.join(" ")).toContain("summarize()");
  });

  test("unbatched embeddings", () => {
    expect(at(r.findings, "unbatched-embeddings", "reviews.ts")).toHaveLength(1);
  });

  test("retry loop with no cap", () => {
    const f = at(r.findings, "retry-storm", "reviews.ts");
    expect(f).toHaveLength(1);
    expect(f[0].title).toContain("no attempt cap");
  });

  test("expensive model on classification", () => {
    const f = at(r.findings, "expensive-model", "reviews.ts");
    expect(f).toHaveLength(1);
    expect(f[0].suggestedModel).toBe("gpt-5-nano");
  });

  test("missing max tokens only where absent", () => {
    const f = at(r.findings, "missing-max-tokens", "reviews.ts");
    expect(f.map((x) => x.startLine)).toEqual([8]);
  });

  test("uncached static system prompt resolved across files", () => {
    const f = at(r.findings, "no-prompt-caching", "agent.ts");
    expect(f).toHaveLength(1);
    expect(f[0].promptTokens).toBeGreaterThan(700);
  });

  test("whole file in prompt", () => {
    expect(at(r.findings, "oversized-context", "agent.ts")).toHaveLength(1);
  });

  test("react: effect with no deps and tight polling", () => {
    expect(at(r.findings, "duplicate-fetch", "Status.tsx")).toHaveLength(1);
    expect(at(r.findings, "polling-no-backoff", "Status.tsx")).toHaveLength(1);
  });

  test("does not flag a dynamic prompt as a static repeat call", () => {
    expect(r.findings.filter((f) => f.pattern === "no-response-cache")).toEqual([]);
  });
});

describe("python fixtures", () => {
  const r = run("bad-py");

  test("history resent every turn in a chat loop", () => {
    const f = at(r.findings, "history-resend", "chatbot.py");
    expect(f).toHaveLength(1);
    expect(f[0].confidence).toBe("high");
  });

  test("bounded retry with no backoff", () => {
    const f = at(r.findings, "retry-storm", "chatbot.py");
    expect(f).toHaveLength(1);
    expect(f[0].title).toContain("no backoff");
  });

  test("tenacity retry with no stop", () => {
    const f = at(r.findings, "retry-storm", "scripts/backfill_tags.py");
    expect(f[0].title).toContain("no stop condition");
  });

  test("offline loop becomes a batch api candidate, not n+1", () => {
    expect(at(r.findings, "batch-api-candidate", "scripts/backfill_tags.py")).toHaveLength(1);
    expect(at(r.findings, "n-plus-one", "scripts/backfill_tags.py")).toHaveLength(0);
  });

  test("opus on a label task", () => {
    const f = at(r.findings, "expensive-model", "scripts/backfill_tags.py");
    expect(f).toHaveLength(1);
    expect(f[0].confidence).toBe("high");
    expect(f[0].suggestedModel).toBe("claude-haiku-5-5");
  });

  test("db dump in prompt, reported once", () => {
    expect(at(r.findings, "oversized-context", "scripts/backfill_tags.py")).toHaveLength(1);
  });

  test("polling with fixed sleep", () => {
    expect(at(r.findings, "polling-no-backoff", "chatbot.py")).toHaveLength(1);
  });
});

describe("clean code", () => {
  test("no findings on trimmed, capped, batched code", () => {
    const r = run("clean");
    expect(r.findings).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  test("repo with no llm usage reports zero call sites", () => {
    const r = analyze([{ path: "src/util.ts", content: "export const add = (a: number, b: number) => a + b;\nfor (const x of [1, 2, 3]) console.log(x);\n" }]);
    expect(r.stats.llmCallSites).toBe(0);
    expect(r.findings).toEqual([]);
  });
});

describe("false positive guards", () => {
  test("twilio messages.create is not an llm call", () => {
    const r = analyze([{ path: "sms.js", content: `const twilio = require("twilio")(sid, token);\nfor (const to of numbers) {\n  await twilio.messages.create({ body: "hi", from: "+1", to });\n}\n` }]);
    expect(r.stats.llmCallSites).toBe(0);
    expect(r.findings).toEqual([]);
  });

  test("ollama calls are free and skipped", () => {
    const r = analyze([{ path: "local.py", content: `from openai import OpenAI\nclient = OpenAI(base_url="http://localhost:11434/v1")\nfor q in questions:\n    client.chat.completions.create(model="llama3", messages=[{"role": "user", "content": q}])\n` }]);
    expect(r.findings).toEqual([]);
  });

  test("loop over a tiny literal list is not n+1", () => {
    const r = analyze([{ path: "a.py", content: `import anthropic\nc = anthropic.Anthropic()\nfor tone in ["short", "long"]:\n    c.messages.create(model="claude-haiku-5-5", max_tokens=100, messages=[{"role": "user", "content": tone + text}])\n` }]);
    expect(r.findings.filter((f) => f.pattern === "n-plus-one")).toEqual([]);
  });

  test("streaming loop is not n+1", () => {
    const r = analyze([{ path: "s.ts", content: `import OpenAI from "openai";\nconst o = new OpenAI();\nconst stream = await o.chat.completions.create({ model: "gpt-4o-mini", max_tokens: 100, messages, stream: true });\nfor await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");\n` }]);
    expect(r.findings).toEqual([]);
  });

  test("comments and strings that mention calls are ignored", () => {
    const r = analyze([{ path: "doc.ts", content: `// for (const x of xs) await openai.chat.completions.create({ model: "gpt-4o" })\nconst help = "call client.chat.completions.create() in a loop";\n` }]);
    expect(r.stats.llmCallSites).toBe(0);
  });
});
