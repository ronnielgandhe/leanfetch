import type { Lang, PatternId } from "./types";

export type SavingsModel =
  | { type: "input"; low: number; high: number }
  | { type: "output"; low: number; high: number }
  | { type: "total"; low: number; high: number }
  | { type: "model-swap" }
  | { type: "cache" }
  | { type: "batch" }
  | { type: "requests"; note: string };

export interface PatternMeta {
  id: PatternId;
  name: string;
  why: string;
  fix: string;
  savings: SavingsModel;
  savingsWhy: string;
  example: Record<Lang, { before: string; after: string }>;
}

export const PATTERNS: Record<PatternId, PatternMeta> = {
  "n-plus-one": {
    id: "n-plus-one",
    name: "llm call inside a loop",
    why: "one request per item means the instructions, system prompt and per-request overhead get paid for again on every iteration. 500 items is 500 copies of the same prompt.",
    fix: "pack several items into one request and ask for a structured list back, or move the loop to a batch job. keep per-item calls only when each item truly needs its own context.",
    savings: { type: "input", low: 0.3, high: 0.6 },
    savingsWhy: "assumes 30-60% of each request is shared instructions that get sent once per batch instead of once per item.",
    example: {
      js: {
        before: `for (const review of reviews) {\n  const res = await openai.chat.completions.create({\n    model, messages: [{ role: "user", content: PROMPT + review }],\n  });\n}`,
        after: `const res = await openai.chat.completions.create({\n  model,\n  messages: [{ role: "user", content: PROMPT + JSON.stringify(reviews.slice(0, 25)) }],\n  response_format: { type: "json_object" },\n});`,
      },
      py: {
        before: `for review in reviews:\n    res = client.chat.completions.create(\n        model=model, messages=[{"role": "user", "content": PROMPT + review}])`,
        after: `chunk = reviews[:25]\nres = client.chat.completions.create(\n    model=model,\n    messages=[{"role": "user", "content": PROMPT + json.dumps(chunk)}],\n    response_format={"type": "json_object"})`,
      },
    },
  },
  "missing-max-tokens": {
    id: "missing-max-tokens",
    name: "no output cap",
    why: "without max_tokens the model can write as much as it wants. output tokens are the expensive ones (often 4-8x the input price), and one runaway answer can cost more than a hundred normal ones.",
    fix: "set max_tokens (or max_completion_tokens / maxOutputTokens) to what the feature actually needs, and handle the truncated case.",
    savings: { type: "output", low: 0.1, high: 0.3 },
    savingsWhy: "assumes a cap trims 10-30% of output tokens by cutting off long tails and rambling answers.",
    example: {
      js: {
        before: `await openai.chat.completions.create({ model, messages });`,
        after: `await openai.chat.completions.create({ model, messages, max_completion_tokens: 400 });`,
      },
      py: {
        before: `client.chat.completions.create(model=model, messages=messages)`,
        after: `client.chat.completions.create(model=model, messages=messages, max_completion_tokens=400)`,
      },
    },
  },
  "retry-storm": {
    id: "retry-storm",
    name: "retry storm",
    why: "a hand-rolled retry loop with no cap or backoff turns one outage into thousands of paid requests. on top of the official sdks, which already retry 429s and 5xx twice by default, every manual retry multiplies the attempts.",
    fix: "use the sdk's built-in retries (max_retries / maxRetries) with exponential backoff, cap the total attempts, and only retry 429, 5xx and network errors.",
    savings: { type: "total", low: 0.05, high: 0.2 },
    savingsWhy: "assumes 5-20% of spend is duplicate attempts during failures. real number depends on how often the upstream errors.",
    example: {
      js: {
        before: `while (true) {\n  try { return await client.messages.create(req); }\n  catch (e) { console.log("retrying"); }\n}`,
        after: `const client = new Anthropic({ maxRetries: 4 });\nreturn await client.messages.create(req);`,
      },
      py: {
        before: `while True:\n    try:\n        return client.messages.create(**req)\n    except Exception:\n        pass`,
        after: `client = anthropic.Anthropic(max_retries=4)\nreturn client.messages.create(**req)`,
      },
    },
  },
  "expensive-model": {
    id: "expensive-model",
    name: "top-tier model on a simple task",
    why: "classification, extraction and short yes/no answers rarely need a frontier model. the small models in the same family are often 10-40x cheaper per token for this kind of work.",
    fix: "route simple, short-output tasks to a small model and keep the big one for reasoning-heavy work. check quality on a handful of real inputs first.",
    savings: { type: "model-swap" },
    savingsWhy: "uses the listed price gap between the detected model and the cheapest model in the same family. low end assumes only half of these calls can move.",
    example: {
      js: {
        before: `await anthropic.messages.create({ model: "claude-opus-5-5", max_tokens: 10,\n  messages: [{ role: "user", content: "classify sentiment: " + text }] });`,
        after: `await anthropic.messages.create({ model: "claude-haiku-5-5", max_tokens: 10,\n  messages: [{ role: "user", content: "classify sentiment: " + text }] });`,
      },
      py: {
        before: `client.chat.completions.create(model="gpt-4o", max_tokens=5,\n    messages=[{"role": "user", "content": f"is this spam? {text}"}])`,
        after: `client.chat.completions.create(model="gpt-5-nano", max_completion_tokens=5,\n    messages=[{"role": "user", "content": f"is this spam? {text}"}])`,
      },
    },
  },
  "no-prompt-caching": {
    id: "no-prompt-caching",
    name: "big static prompt, no caching",
    why: "the same long system prompt is billed at full input price on every call. with prompt caching, repeat reads cost a small fraction of the input price after the first write.",
    fix: "mark the static system prompt with cache_control, keep it byte-identical between calls (no timestamps or ids in it), and put changing content after it.",
    savings: { type: "cache" },
    savingsWhy: "uses the measured prompt size (about 4 characters per token) and the model's listed cache read price. low assumes a 50% hit rate, high 90%. includes the cache write premium on misses.",
    example: {
      js: {
        before: `await client.messages.create({ model, max_tokens: 1024,\n  system: LONG_SYSTEM_PROMPT, messages });`,
        after: `await client.messages.create({ model, max_tokens: 1024,\n  system: [{ type: "text", text: LONG_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],\n  messages });`,
      },
      py: {
        before: `client.messages.create(model=model, max_tokens=1024,\n    system=LONG_SYSTEM_PROMPT, messages=messages)`,
        after: `client.messages.create(model=model, max_tokens=1024,\n    system=[{"type": "text", "text": LONG_SYSTEM_PROMPT,\n             "cache_control": {"type": "ephemeral"}}],\n    messages=messages)`,
      },
    },
  },
  "history-resend": {
    id: "history-resend",
    name: "full history resent every turn",
    why: "the whole conversation goes out on every turn and nothing ever drops off, so turn 40 pays for turns 1-39 again. cost grows with the square of the conversation length.",
    fix: "keep a window of recent turns, summarize older ones, or cap by token count. if you need the full history, cache the stable prefix.",
    savings: { type: "input", low: 0.3, high: 0.7 },
    savingsWhy: "assumes trimming or summarizing removes 30-70% of input tokens on long conversations.",
    example: {
      js: {
        before: `messages.push({ role: "user", content: input });\nconst res = await client.chat.completions.create({ model, messages });`,
        after: `messages.push({ role: "user", content: input });\nconst recent = [messages[0], ...messages.slice(-12)];\nconst res = await client.chat.completions.create({ model, messages: recent });`,
      },
      py: {
        before: `history.append({"role": "user", "content": text})\nres = client.chat.completions.create(model=model, messages=history)`,
        after: `history.append({"role": "user", "content": text})\nrecent = history[:1] + history[-12:]\nres = client.chat.completions.create(model=model, messages=recent)`,
      },
    },
  },
  "oversized-context": {
    id: "oversized-context",
    name: "whole file or table in the prompt",
    why: "dumping a whole file, document or query result into a prompt pays for every token of it on every call, most of which the model never needs.",
    fix: "select only the relevant parts: chunk and retrieve, filter rows and columns in the query, or summarize once and reuse the summary.",
    savings: { type: "input", low: 0.4, high: 0.8 },
    savingsWhy: "assumes retrieval or filtering keeps 20-60% of the dumped content.",
    example: {
      js: {
        before: `const doc = fs.readFileSync(path, "utf8");\nconst res = await llm({ prompt: \`answer using this:\\n\${doc}\\n\\nq: \${q}\` });`,
        after: `const chunks = await index.search(q, { topK: 5 });\nconst res = await llm({ prompt: \`answer using this:\\n\${chunks.join("\\n")}\\n\\nq: \${q}\` });`,
      },
      py: {
        before: `rows = cursor.fetchall()\nprompt = f"analyze these orders: {rows}"`,
        after: `rows = cursor.execute("select id, total from orders where flagged limit 50").fetchall()\nprompt = f"analyze these orders: {rows}"`,
      },
    },
  },
  "unbatched-embeddings": {
    id: "unbatched-embeddings",
    name: "embeddings one at a time",
    why: "embedding apis accept many inputs per request. one request per item multiplies request count, latency and rate-limit pressure. the token bill is the same either way, so the win here is speed and headroom, not dollars, unless the job can also move to a batch api.",
    fix: "send inputs in batches (an array of strings per request), or use embedMany / embed_documents.",
    savings: { type: "requests", note: "token cost unchanged; requests drop by about the batch size" },
    savingsWhy: "embedding prices are per token, so batching does not change the token bill. it cuts request count by roughly the batch size.",
    example: {
      js: {
        before: `for (const doc of docs) {\n  const e = await openai.embeddings.create({ model, input: doc.text });\n}`,
        after: `const e = await openai.embeddings.create({ model, input: docs.map((d) => d.text) });`,
      },
      py: {
        before: `for doc in docs:\n    e = client.embeddings.create(model=model, input=doc.text)`,
        after: `e = client.embeddings.create(model=model, input=[d.text for d in docs])`,
      },
    },
  },
  "no-response-cache": {
    id: "no-response-cache",
    name: "identical call, no cache",
    why: "the same request goes out again and again and gets the same answer back. every repeat is paid for in full.",
    fix: "cache the response keyed on the inputs (in memory, redis, or a table), or compute it once at build time.",
    savings: { type: "total", low: 0.5, high: 0.95 },
    savingsWhy: "assumes 50-95% of these calls would be cache hits, since the inputs do not change.",
    example: {
      js: {
        before: `async function tagline() {\n  return (await client.messages.create(STATIC_REQUEST)).content;\n}`,
        after: `let cached;\nasync function tagline() {\n  cached ??= (await client.messages.create(STATIC_REQUEST)).content;\n  return cached;\n}`,
      },
      py: {
        before: `def tagline():\n    return client.messages.create(**STATIC_REQUEST).content`,
        after: `@functools.cache\ndef tagline():\n    return client.messages.create(**STATIC_REQUEST).content`,
      },
    },
  },
  "batch-api-candidate": {
    id: "batch-api-candidate",
    name: "offline job on the sync api",
    why: "this looks like a script, cron or pipeline that loops over items with synchronous calls. nobody is waiting on the answer, and the batch apis from anthropic, openai and google cost half the standard price.",
    fix: "submit the items as one batch job and collect the results when it finishes (usually within hours, often much sooner).",
    savings: { type: "batch" },
    savingsWhy: "uses each provider's listed batch discount (50% for anthropic, openai and google).",
    example: {
      js: {
        before: `for (const row of rows) {\n  await client.messages.create({ model, max_tokens: 300, messages: toMessages(row) });\n}`,
        after: `await client.messages.batches.create({\n  requests: rows.map((row, i) => ({ custom_id: String(i),\n    params: { model, max_tokens: 300, messages: toMessages(row) } })),\n});`,
      },
      py: {
        before: `for row in rows:\n    client.messages.create(model=model, max_tokens=300, messages=to_messages(row))`,
        after: `client.messages.batches.create(requests=[\n    {"custom_id": str(i), "params": {"model": model, "max_tokens": 300,\n                                     "messages": to_messages(row)}}\n    for i, row in enumerate(rows)])`,
      },
    },
  },
  "polling-no-backoff": {
    id: "polling-no-backoff",
    name: "tight polling loop",
    why: "polling on a short fixed interval sends requests whether or not anything changed. most of them return the same answer.",
    fix: "use webhooks or server-sent events if the api has them; otherwise back off exponentially, stop when the tab is hidden, and use etags or if-modified-since.",
    savings: { type: "requests", note: "requests drop with the polling rate" },
    savingsWhy: "generic apis have no shared price list, so this is counted in requests, not dollars.",
    example: {
      js: {
        before: `setInterval(async () => {\n  setStatus(await (await fetch("/api/status")).json());\n}, 1000);`,
        after: `let delay = 1000;\nasync function poll() {\n  const res = await fetch("/api/status", { headers: { "if-none-match": etag } });\n  delay = res.status === 304 ? Math.min(delay * 2, 30000) : 1000;\n  setTimeout(poll, delay);\n}`,
      },
      py: {
        before: `while True:\n    status = requests.get(url).json()\n    time.sleep(1)`,
        after: `delay = 1\nwhile not done:\n    status = requests.get(url).json()\n    time.sleep(delay)\n    delay = min(delay * 2, 30)`,
      },
    },
  },
  "duplicate-fetch": {
    id: "duplicate-fetch",
    name: "duplicate fetch",
    why: "the same request is made more than once when one would do: inside a loop where nothing in the url changes, twice in the same function, or in an effect that re-runs on every render.",
    fix: "fetch once and reuse the result, hoist it out of the loop, add a dependency array to the effect, or use a client cache (swr, react query) that dedupes in-flight requests.",
    savings: { type: "requests", note: "duplicate requests removed" },
    savingsWhy: "generic apis have no shared price list, so this is counted in requests, not dollars.",
    example: {
      js: {
        before: `useEffect(() => {\n  fetch("/api/me").then((r) => r.json()).then(setMe);\n});`,
        after: `useEffect(() => {\n  fetch("/api/me").then((r) => r.json()).then(setMe);\n}, []);`,
      },
      py: {
        before: `for user in users:\n    config = requests.get(CONFIG_URL).json()\n    apply(user, config)`,
        after: `config = requests.get(CONFIG_URL).json()\nfor user in users:\n    apply(user, config)`,
      },
    },
  },
};

export const PATTERN_ORDER: PatternId[] = [
  "n-plus-one",
  "batch-api-candidate",
  "expensive-model",
  "no-prompt-caching",
  "history-resend",
  "oversized-context",
  "no-response-cache",
  "missing-max-tokens",
  "retry-storm",
  "unbatched-embeddings",
  "duplicate-fetch",
  "polling-no-backoff",
];
