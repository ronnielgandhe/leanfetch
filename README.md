# leanfetch

a tool that stops startups from losing cash to unnecessary api calls. paste a public github repo or drop your code, get a report of the wasteful llm and api patterns in it, with a savings estimate you can poke at.

![leanfetch](docs/screenshot.png)

## how it works

1. **fetch.** repos come in as a tarball from codeload.github.com (default branch looked up through the github api), unpacked in memory. capped at 25mb compressed and the 600 most relevant source files. vendor, build, lock, minified and test files are skipped. uploads are read in your browser (plain files or a .zip) and only the source text is sent.
2. **analyze.** static detectors written in typescript run over js, ts and python. regex plus light structure parsing: comments and strings are stripped before matching, loops and functions are found with bracket and indent matching, and wrapper functions are tracked across files so a loop that calls your own `summarize()` still counts. no model is involved, so this part is free and gives the same answer every time.
3. **estimate.** every finding gets a dollar range from a pricing table and assumptions you can change on the page.
4. **deep read (optional).** if the server has an anthropic key, "scan + deep read" sends only the top flagged snippets (capped) to claude, which confirms or rejects each one and writes the assessment. the system prompt is cached and output is capped, so the tool practices what it preaches.

## what it catches

| pattern | what it looks for |
|---|---|
| llm call inside a loop | a chat call in a loop over a collection, directly or through a wrapper defined in the repo |
| no output cap | chat calls with no max_tokens / max_completion_tokens / max_output_tokens (skips anthropic, which requires it) |
| retry storm | hand-rolled retry loops with no attempt cap or no backoff, tenacity/backoff decorators with no stop, manual retries stacked on sdk retries |
| top-tier model on a simple task | opus / gpt-4o / pro class models where the prompt reads like classification or extraction, or the output cap is tiny |
| big static prompt, no caching | anthropic calls with a 512+ token static system prompt and no cache_control, or a timestamp near the top of a big prompt |
| full history resent every turn | a messages array that only grows (push/append) and is sent whole, with no slicing, windowing or summarizing |
| whole file or table in the prompt | file reads, `select *`, `fetchall()`, dumps of rows interpolated into a prompt with no truncation or chunking |
| embeddings one at a time | embedding calls inside a loop instead of one batched request |
| identical call, no cache | requests built only from literals that run in a loop or a shared function, and the same call made twice in a row |
| offline job on the sync api | loops of llm calls in scripts, cron jobs, evals and pipelines that could use a batch api |
| tight polling loop | setInterval or while-true loops that hit an api on a short fixed interval |
| duplicate fetch | a fetch in a loop that does not use the loop variable, the same request twice in a function, useEffect with no dependency array |

every finding shows a confidence level. it only reports things it can point to in the code, and it says so when a repo has no llm usage at all instead of calling it clean. if a scan step fails, the report says it is incomplete.

honest limits: it is pattern matching, not a type checker. it can miss calls hidden behind dynamic dispatch or config, and it can flag a loop that only ever runs three times. go and other languages are not covered yet.

## the savings math

```
monthly cost of a call site = calls/day x 30 x (input tokens x input price + output tokens x output price) / 1m
waste = that cost x a pattern-specific share
```

the share depends on the pattern: batch apis are a flat 50%, a model swap uses the real price gap between the two models, prompt caching uses the measured prompt size and the cache read price at a 50 to 90% hit rate, and the rest use a stated range (for example 30 to 60% of input tokens for batching items into one request). each finding shows its own math.

the totals count each call site once and leave out low confidence findings. we cannot see your traffic, so calls per day, tokens per call and the model are assumptions you set in the simulator. prices live in `lib/pricing.ts` with a `PRICING_AS_OF` date and source links (anthropic, openai, google). models that are not in the table get no dollar figure instead of a guess. embedding batching and generic http findings are counted in requests, not dollars.

## run it locally

```bash
git clone https://github.com/ronnielgandhe/leanfetch.git
cd leanfetch
npm install
npm run dev
```

opens at `http://localhost:3000`. `npm test` runs the detector tests against the fixtures in `tests/fixtures`.

## env vars

all optional. names are in `.env.example`.

| name | what it does |
|---|---|
| `ANTHROPIC_API_KEY` | turns on deep read. never sent to the browser |
| `DEEP_READ_MODEL` | model for deep read, defaults to `claude-sonnet-5-5` |
| `GITHUB_TOKEN` | raises the github api rate limit for default branch lookups |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | shared rate limiting. without them limits are in memory per instance, which is best effort on serverless |
| `SCAN_LIMIT_PER_10_MIN` | scans per ip per 10 minutes, default 10 |
| `DEEP_READ_LIMIT_PER_IP_PER_DAY` | deep reads per ip per day, default 3 |
| `DEEP_READ_LIMIT_PER_DAY` | deep reads per day for everyone, default 150 |

## built with

next.js, typescript, tailwind, the anthropic sdk, fflate for zips in the browser, vitest.

built by [ronniel gandhe](https://github.com/ronnielgandhe) and [violet li](https://github.com/violetliie)
