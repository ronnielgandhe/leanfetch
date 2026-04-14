# LeanFetch

**LLM API cost auditor. scans codebases for inefficiency patterns before they hit production.**

<p align="center">
  <img src="public/readme/leanfetch-splash.png" width="100%" />
</p>

<p align="center">
  <img src="public/readme/leanfetch-inputs.png" width="100%" />
</p>

---

## why this exists

i kept seeing the same thing across every AI project i looked at - devs shipping code that's burning 2-3x what it needs to on API costs. N+1 calls inside loops, full conversation histories resent every turn, using opus for stuff haiku could handle in its sleep. the patterns are obvious once you know what to look for, but nobody had built a proper tool to catch them automatically.

so i built one. paste a github repo, upload files, or submit a design doc before you even write code. LeanFetch runs a multi-phase analysis and gives you a prioritized report - what's wrong, how bad it is, and how to fix it.

---

## how it works

the backend runs a 7-phase pipeline. each phase is intentional - i wanted the scanner itself to be as cost-efficient as the patterns it catches.

```
GitHub Repo / Files / Design Doc
        ↓
   1. FETCH     git clone --depth 1
   2. FILTER    smart file selection (skip vendor, tests, configs)
   3. KEYWORD   40+ regex patterns across 15+ LLM providers
   4. TRIAGE    hybrid regex + LLM classification
   5. DEEP SCAN per-file analysis with Sonnet
   6. SYNTHESIS final report generation with Opus
        ↓
   Prioritized Report + Cost Savings
```

---

## design decisions

**hybrid triage was the big one.** i could have thrown every file at an LLM and called it a day, but that defeats the point of a cost-efficiency tool being wasteful itself. so regex handles the first pass - it catches ~80% of direct SDK calls instantly, for free. haiku only steps in for the edge cases that regex can't see - wrapper functions, indirect imports, custom abstractions around API calls. speed where i can get it, intelligence where i need it.

**model routing by task complexity.** haiku for triage because it's cheap and fast. sonnet for deep per-file analysis because it's smart enough to understand code patterns in context. opus for the final synthesis because it's the best at consolidating findings across files into a coherent report. each model earns its spot in the pipeline. the scanner practices what it preaches.

**NDJSON streaming instead of a loading spinner.** a full scan can take a couple minutes on a big repo. i didn't want users staring at a spinner wondering if it was working. the backend streams progress updates in real-time - what phase you're in, how many files have been scanned, what's been found so far. it made the whole experience feel alive instead of just waiting.

**capping and chunking for scale.** tested this on 4000+ file monorepos and learned fast that you can't just scan everything. files get ranked by keyword density, capped at 200 for triage and top 20 for deep scan. files over 500 lines get chunked with header preservation so the LLM keeps cross-file context without overflowing. it's a tradeoff between thoroughness and not timing out, and i'd rather give you a fast accurate scan of the most relevant files than a slow scan that tries to cover everything.

**plan analysis as a separate pipeline.** this was the most recent addition. design docs aren't code - there's no files to scan, no imports to regex against. it's about intent. the prompts are completely different because you're catching patterns that haven't been written yet. "you're planning to resend full conversation history every turn - here's why that's going to cost you."

---

## what it catches

| pattern | severity | what's happening |
|---------|----------|-----------------|
| N+1 API calls | critical | API call inside a loop instead of batching |
| missing max_tokens | warning | unbounded output = unbounded cost |
| no prompt caching | info | resending large system prompts every call |
| wrong model tier | info | using opus for simple classification |
| full history resend | warning | entire conversation context every turn |
| unbounded concurrency | warning | parallel API calls with no rate limit |
| misconfigured caching | critical | cache_control at wrong API level |
| oversized context | warning | entire documents injected as context |
| redundant embeddings | warning | duplicate embedding calls without dedup |

11 patterns across 15+ LLM providers (Anthropic, OpenAI, Gemini, Bedrock, Cohere, Groq, Mistral, and more) in Python, JavaScript, TypeScript, Go, Java, Rust, C#, and more.

---

## three input modes

- **github repo** - paste a URL, leanfetch clones and scans it
- **file upload** - drag-and-drop source files for targeted analysis
- **plan analysis** - upload a design doc (PDF, DOCX, markdown) and catch cost antipatterns before writing a single line of code

---

## tech

**backend:** node.js, express, anthropic SDK  
**frontend:** react 19, vite 6, tailwind CSS  
**analysis:** claude haiku / sonnet / opus (multi-model pipeline)  
**parsing:** pdf-parse, mammoth (DOCX)  

---

## run locally

```bash
git clone https://github.com/ronnielgandhe/leanfetch.git
cd leanfetch
npm install && cd client && npm install && cd ../server && npm install && cd ..
npm run dev
```

opens at `http://localhost:5173`

---

built by [ronniel gandhe](https://github.com/ronnielgandhe) and [violet li](https://github.com/violetliie)
