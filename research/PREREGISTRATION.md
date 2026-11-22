# preregistration: model fit for three hard-coded defaults

written and committed on 2026-11-22, before any pilot or main batch was run. the only model calls made before this file was committed were one-word "reply OK" availability checks per model and the template classifier in `callsites/classify.py`. no task outputs had been seen.

## question

for a call site where a popular open source repo hard-codes a default model for a specific job, does a cheaper model do that same job at least as well, measured on a public dataset with the dataset's own metric?

## targets (exact commits in `targets.json`)

| id | repo @ commit | call site | default model | job |
|---|---|---|---|---|
| T1 | microsoft/graphrag @ 34b2b67 | `packages/graphrag/graphrag/config/defaults.py:33` (`DEFAULT_COMPLETION_MODEL = "gpt-4.1"`) used by `index/operations/extract_graph/graph_extractor.py` with `prompts/index/extract_graph.py` | gpt-4.1 | entity + relationship extraction to a delimited format |
| T2 | deepset-ai/haystack @ 85b8d4e | `components/evaluators/faithfulness.py` -> `llm_evaluator.py:114` (`OpenAIChatGenerator(generation_kwargs={"response_format": {"type": "json_object"}, "seed": 42})`) -> `components/generators/chat/openai.py:135` (`model: str = "gpt-5.6-terra"`) | gpt-5.6-terra | faithfulness judging (split answer into statements, score each 0/1 against context) |
| T3 | run-llama/llama_index @ 99d7433 | `llama-index-llms-openai/llama_index/llms/openai/responses.py:105` (`DEFAULT_OPENAI_MODEL = "gpt-4o-mini"`, temperature default 0.1) with `llama-index-core/llama_index/core/prompts/chat_prompts.py` `CHAT_TEXT_QA_PROMPT` | gpt-4o-mini | rag answer from retrieved context |

side check, not benchmarked: `llama-index-llms-openai/llama_index/llms/openai/base.py:99` sets `DEFAULT_OPENAI_MODEL = "gpt-3.5-turbo"`, which is what `Settings.llm` resolves to when nothing is configured. the model page says it was shut down on 2026-10-23. we will record one live call to confirm.

## datasets and samples (seed 20261122)

- T1: Few-NERD, supervised split, test set (DFKI-SLT/few-nerd on hugging face, CC BY-SA 4.0). sentence indices are shuffled with the seed, then cut into documents of 6 consecutive shuffled sentences. pilot = first 20 documents, main = next 200 documents. gold entities are spans with coarse types person, organization, location, event.
- T2: HaluEval QA (RUCAIBox/HaluEval `data/qa_data.json`, MIT). rows are shuffled with the seed. pilot = first 20 rows, main = next 300 rows. within each set, the first half after shuffling gets the right answer (label faithful) and the second half gets the hallucinated answer (label unfaithful), so main has exactly 150/150. contexts = [knowledge].
- T3: HotpotQA distractor, validation (hotpotqa/hotpot_qa on hugging face, CC BY-SA 4.0). rows are shuffled with the seed. pilot = first 20, main = next 300. context = the two supporting-fact paragraphs (oracle retrieval at llamaindex's default top_k = 2) in a seeded random order, each rendered like a llamaindex node with metadata: `title: <title>\n\n<text>`, joined with `\n\n`.

budget rule, decided only from pilot token counts and never from pilot quality: if the projected main cost of a target would push total spend past the 25 usd cap, that target's main n is cut to 150 (T1) or 200 (T2, T3), and if that is still not enough the ladder drops models in this order: gpt-4.1-mini, gemini-3.1-flash-lite, claude-sonnet-5-5. the repo's own model is never dropped.

## model ladder (same for every target)

gpt-4.1, gpt-5.6-terra, gpt-4.1-mini, gpt-4o-mini, gpt-6-luna, gpt-5-nano, claude-sonnet-5-5, claude-haiku-5-5, gemini-3.1-flash-lite, gemini-2.5-flash-lite. prices in `prices.json`, checked against the live provider pages on 2026-11-22.

## how each call is replayed

every model gets the repo's exact prompt text and message structure. parameters follow the repo; where an api rejects a parameter the parameter is omitted for that model and the omission is logged.

- T1: one user message = `GRAPH_EXTRACTION_PROMPT` with `entity_types = organization,person,geo,event`. graphrag's default `max_gleanings = 1`, so each document gets the initial call plus one continuation call with `CONTINUE_PROMPT` (with `max_gleanings = 1` the loop exits before the Y/N `LOOP_PROMPT`). outputs of both calls are concatenated and parsed with graphrag's own record logic (split on `##`, strip parens, split on `<|>`). no temperature or token cap is set (graphrag sets none by default); anthropic requires `max_tokens`, set to 16000.
- T2: one user message = haystack's `LLMEvaluator.prepare_template()` output rendered with jinja2 exactly like haystack's `PromptBuilder` (questions as a string, contexts as a python list repr, predicted_answers as a string). openai models get `response_format={"type":"json_object"}` and `seed=42`; gemini gets `response_mime_type="application/json"`; claude gets its native json mode (structured output with a schema `{statements: string[], statement_scores: integer[]}`), since haystack's docs say the generator must be configured to return json.
- T3: system + user messages from `CHAT_TEXT_QA_PROMPT`. temperature 0.1 is sent to models whose api accepts it and omitted otherwise. no token cap. openai calls go through chat completions with the same messages (llamaindex's `OpenAIResponses` uses the responses api; same model, same messages).
- provider defaults are kept for reasoning effort / thinking (openai reasoning models at their default effort, claude 5.5 models at their default effort with adaptive thinking, gemini at its default). this matches what a user gets by swapping only the model string. thinking/reasoning tokens are billed as output and are counted.

## metrics

- T1 primary: typed entity micro-F1. per document, predictions and gold are sets of (normalized name, type). graphrag types map PERSON->person, ORGANIZATION->organization, GEO->location, EVENT->event; any other predicted type is dropped. a prediction whose normalized name equals a gold span of an excluded coarse type (building, art, product, other) is ignored (neither true nor false positive), because graphrag's own few-shot example labels a building as GEO. normalization: uppercase, curly quotes to straight, strip surrounding quotes and punctuation except `&` and `.` inside words, collapse whitespace, drop a leading `THE `. secondary: untyped entity micro-F1 on the same sets.
- T2 primary: balanced accuracy. haystack's per-item score is mean(statement_scores); predicted faithful iff score >= 0.5. parsing follows haystack: strict `json.loads` of the reply, must contain both keys, list lengths must match. a reply that fails to parse counts as a wrong prediction. secondary: accuracy, parse-failure rate, and a lenient parse (strip markdown fences) as a sensitivity check.
- T3 primary: answer containment accuracy. normalize gold and response with the squad/hotpotqa normalizer (lowercase, drop punctuation and articles, collapse whitespace). non yes/no items: correct iff the gold token sequence appears contiguously in the response tokens. yes/no items: correct iff the first response token equals the gold word. secondary: hotpotqa token F1.
- cost: measured input and output tokens per item times the listed price, reported as usd per 1k calls and usd per 1M calls. for T1 a "call" means the full default extraction for one document (both requests).
- latency: median and p90 wall clock per item, reported only, not used for decisions.

## statistics and decision rule

- paired item-level bootstrap, 10,000 resamples, seed 7, resampling items (documents for T1, recomputing micro-F1 each resample).
- for each alternative vs the repo's model: difference on the primary metric (alt minus repo), 95% percentile interval for reporting, and a 99.44% interval (bonferroni for 9 comparisons per target) for decisions. binary metrics also get an exact mcnemar test.
- non-inferiority margin, fixed now: delta = 0.03 absolute on the primary metric for all three targets.
- non-inferior: lower bound of the 99.44% interval > -0.03.
- strictly better: lower bound of the 99.44% interval > 0.
- materially cheaper: measured cost per call <= 0.5x the repo model's measured cost per call.
- "the default is the wrong pick for this job on this dataset" may be claimed only if at least one alternative is non-inferior AND materially cheaper. otherwise the default is reported as defensible, and if some cheaper model is close but its interval crosses the margin, that is reported as inconclusive.
- api errors that persist after sdk retries and one later re-run count as failures (score 0 for that item) and are reported per model.

## what this does not claim

nothing about the maintainers or their reasons, nothing about jobs other than the measured one, and nothing about real user traffic. a dataset is a proxy. the prompt is the repo's prompt, tuned (if at all) for the repo's model, which can only favor the repo's model.
