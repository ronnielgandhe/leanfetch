# is your default model actually the right one? i checked three famous repos

ronniel gandhe. draft, november 2026.

## tl;dr

- **graphrag picked wrong for this job.** at commit `34b2b67` it defaults to `gpt-4.1` for entity extraction. on Few-NERD (150 documents), 6 of the 7 cheaper models on my ladder beat it outright, whole 99.44% interval above zero. same provider, `gpt-6-luna`: +7.7 F1 points (+5.3 to +10.5) at 7% of the cost, $1,755 vs $24,049 per million documents. `gemini-3.1-flash-lite`: +11.7 points at 11%.
- **haystack picked fine.** its faithfulness judge defaults to `gpt-5.6-terra`, which came second of ten and nothing cheaper cleared the bar. `gpt-6-luna` tied it at 6% of the cost, but the interval is too wide to call it.
- **llamaindex's cheap default is fine.** `gpt-4o-mini` for rag answers: the only two cheaper models were worse.
- **bonus:** llamaindex's plain `OpenAI` class still defaults to `gpt-3.5-turbo`, which openai shut down. zero-config users get a 404.
- total api spend for everything, pilots included: 12.81 usd. every number has a saved raw output behind it and the rules were committed before the runs.

## the question

every llm framework ships a default model. most people never change it. so the default is, quietly, a pricing decision for a lot of teams who never made it.

so here's the question i wanted answered: take a call site where a well known repo hard-codes a model for one specific job. figure out what the job actually is. then run that exact job, with the repo's exact prompt, on public data that has real answers, across a ladder of models from three providers. is the default the right pick, or is something way cheaper just as good?

"right pick" needs a rule, not vibes. so before running anything i wrote the rule down and committed it (`PREREGISTRATION.md`, commit `cd5234e`): an alternative only beats the default if it is non-inferior on the dataset's own metric (99.44% paired bootstrap interval stays above minus 3 points) AND it costs at most half as much per call, measured from real token counts. if nothing clears that bar, the default is defensible and i say so.

## what leanfetch does here

leanfetch already scans a repo and flags where the llm bill leaks: calls in loops, no output cap, no caching, big models on small jobs. it's static analysis, no model involved. the weak spot was "big model on a small job": it guessed the job from keywords.

for this i added a small step in `research/callsites/`:

1. `extract.ts` reuses leanfetch's own parser (`lib/analyze/source.ts`, `lib/analyze/structure.ts`) and walks a checkout. it pulls three things, deterministically: llm call sites (leanfetch's existing detectors), model defaults (any assignment or kwarg default whose value is a model id, with file and line), and prompt templates (long string constants that read like prompts, with their placeholders).
2. `classify.py` sends each template to `claude-haiku-5-5` once, cached, and asks for one label from a fixed list (classification, extraction, summarization, query rewriting, rag answer, code generation, tool selection, grading/judging, reranking, chat, other), plus a public benchmark with the same shape and its metric. that's the only model in the scan, and it only classifies.

on the five repos i scanned it found 50 model defaults and 67 prompt templates for under two cents (`results/callsites/`). it correctly tagged graphrag's `GRAPH_EXTRACTION_PROMPT` as structured extraction with an entity-F1 benchmark analogue. two honest gaps: it can't always tell which default model runs which template (that link goes through config objects and constructors), and it misses prompts that are assembled in code, like haystack's evaluator prompt. for the three targets below i traced that link by hand and wrote down file and line.

## the targets

i wanted defaults that a lot of people inherit, a job that maps cleanly onto a public dataset, and a permissive license. three made the cut:

| | repo @ commit | default | where | job |
|---|---|---|---|---|
| T1 | microsoft/graphrag (36.7k stars, MIT) @ `34b2b67` | `gpt-4.1` | `packages/graphrag/graphrag/config/defaults.py:33`, used by `index/operations/extract_graph/graph_extractor.py` with `prompts/index/extract_graph.py` | pull entities and relationships out of text into graphrag's delimited format |
| T2 | deepset-ai/haystack (27.1k stars, Apache-2.0) @ `85b8d4e` | `gpt-5.6-terra` | `components/generators/chat/openai.py:135`, reached from `components/evaluators/llm_evaluator.py:114` when `FaithfulnessEvaluator()` gets no generator | faithfulness judge: split an answer into statements, score each 0/1 against the context |
| T3 | run-llama/llama_index (53.0k stars, MIT) @ `99d7433` | `gpt-4o-mini` | `llama-index-llms-openai/llama_index/llms/openai/responses.py:105` with the core `CHAT_TEXT_QA_PROMPT` | answer a question from retrieved context |

when were these lines last touched (github blame at those commits): graphrag's `gpt-4.1` default on 2026-01-27 (the v3 rewrite), haystack's `gpt-5.6-terra` on 2026-10-26 (a deliberate move to that model), llamaindex's `gpt-4o-mini` responses default on 2025-03-28. so two of these are recent, deliberate choices. that matters for how you read the results.

bonus finding, no benchmark needed: llamaindex's plain `OpenAI` class still defaults to `gpt-3.5-turbo` (`llama-index-llms-openai/llama_index/llms/openai/base.py:99`, last changed 2023-11-15), and that's what `Settings.llm` resolves to if you configure nothing. openai's model page says gpt-3.5-turbo was shut down on 2026-10-23, and a live call on 2026-11-22 returned `404 The model gpt-3.5-turbo has been deprecated` (`results/defaults_alive.json`). same for `gpt-3.5-turbo-16k`, the default in `core/postprocessor/rankGPT_rerank.py:20`. so the zero-config path errors on the first call. that's not a cost leak, it's a dead default, and it's a one-line fix.

## the method, plainly

- **same prompt, same structure.** prompts are read at run time out of the pinned checkouts with python's `ast`, not retyped (`lib/prompts.py`). graphrag gets its real two-request flow (extract, then one "MANY entities were missed" continuation, because `max_gleanings` defaults to 1) and its real parser. haystack's prompt is rebuilt with its own template logic and rendered with jinja2 like its `PromptBuilder`, and parsed with its strict `json.loads` rule. llamaindex gets its system + user chat messages and its 0.1 temperature where the api accepts it.
- **public data with real answers.** T1: Few-NERD supervised test (CC BY-SA 4.0), 6 shuffled sentences per document, gold person/organization/location/event spans. T2: HaluEval QA (MIT), half right answers, half hallucinated ones, against the given knowledge. T3: HotpotQA distractor dev (CC BY-SA 4.0) with the two gold paragraphs as the "retrieved" context. all samples are seeded (20261122) and the pilot items are kept out of the main sample.
- **ten models, three providers, every price tier.** gpt-4.1, gpt-5.6-terra, gpt-4.1-mini, gpt-4o-mini, gpt-6-luna, gpt-5-nano, claude-sonnet-5-5, claude-haiku-5-5, gemini-3.1-flash-lite, gemini-2.5-flash-lite. provider defaults for reasoning effort, because that's what you get when you only swap the model string. reasoning tokens are billed as output and they're counted.
- **the dataset's own metric, no llm judge.** T1 typed entity micro-F1. T2 balanced accuracy of haystack's faithful/unfaithful call (score >= 0.5). T3 answer containment.
- **real cost.** measured input and output tokens times list price (checked on the provider pages on 2026-11-22), reported per million calls.
- **stats.** paired bootstrap over items, 10,000 resamples. 95% intervals for reading, 99.44% (bonferroni for 9 comparisons) for decisions, exact mcnemar on the binary ones.
