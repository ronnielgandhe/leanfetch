## appendix a: model ids and prices

prices checked against the live provider pages on 2026-11-22. usd per 1M tokens, standard tier, no caching, no batch.

| model id (requested) | served as | input | output |
|---|---|---|---|
| `gpt-4.1` | `gpt-4.1-2025-04-14` | $2.00 | $8.00 |
| `gpt-4.1-mini` | `gpt-4.1-mini-2025-04-14` | $0.40 | $1.60 |
| `gpt-4o-mini` | `gpt-4o-mini-2024-07-18` | $0.15 | $0.60 |
| `gpt-5.6-terra` | `gpt-5.6-terra` | $2.00 | $12.00 |
| `gpt-6-luna` | `gpt-6-luna` | $0.10 | $0.50 |
| `gpt-5-nano` | `gpt-5-nano-2025-08-07` | $0.05 | $0.40 |
| `claude-sonnet-5-5` | `claude-sonnet-5-5` | $2.00 | $10.00 |
| `claude-haiku-5-5` | `claude-haiku-5-5` | $0.10 | $0.50 |
| `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | $0.25 | $1.50 |
| `gemini-2.5-flash-lite` | `gemini-2.5-flash-lite` | $0.10 | $0.40 |

sources: anthropic: https://platform.claude.com/docs/en/about-claude/pricing, openai: https://developers.openai.com/api/docs/pricing, google: https://aistudio.google.com/docs/pricing (redirect from ai.google.dev/gemini-api/docs/pricing), openai_gpt35: https://developers.openai.com/api/docs/models/gpt-3.5-turbo

## appendix b: target commits

| repo | commit | url |
|---|---|---|
| graphrag | `34b2b67ae4601ad0b47bcd179fbe3f2a23aa0857` | https://github.com/microsoft/graphrag |
| haystack | `85b8d4e0b8332a60002c3e06972386476fba6b7a` | https://github.com/deepset-ai/haystack |
| llama_index | `99d7433f6f71888951379ccca9294e272442c832` | https://github.com/run-llama/llama_index |
| deepeval | `aeb529e8b79cae158c8f1033b7b4360127ced585` | https://github.com/confident-ai/deepeval |
| mem0 | `fff8a6472512d1bc1a4bccab8c645b65a1df7fe5` | https://github.com/mem0ai/mem0 |

default-model liveness check (`results/defaults_alive.json`):

| repo | line | model | result |
|---|---|---|---|
| graphrag | `packages/graphrag/graphrag/config/defaults.py:33` | `gpt-4.1` | ok |
| haystack | `haystack/components/generators/chat/openai.py:135` | `gpt-5.6-terra` | ok |
| llama_index | `llama-index-llms-openai/llama_index/llms/openai/responses.py:105` | `gpt-4o-mini` | ok |
| llama_index | `llama-index-llms-openai/llama_index/llms/openai/base.py:99` | `gpt-3.5-turbo` | error: Error code: 404 - The model `gpt-3.5-turbo` has been deprecated, learn more here: https:// |
| llama_index | `llama-index-core/llama_index/core/postprocessor/rankGPT_rerank.py:20` | `gpt-3.5-turbo-16k` | error: Error code: 404 - The model `gpt-3.5-turbo-16k` has been deprecated, learn more here: http |

## appendix c: exact prompts

pulled at run time from the pinned checkouts with `ast` (see `lib/prompts.py`), so these are byte-for-byte the repo strings.

### T1 graphrag `GRAPH_EXTRACTION_PROMPT` (first request; `{entity_types}` = `organization,person,geo,event`)

```text

-Goal-
Given a text document that is potentially relevant to this activity and a list of entity types, identify all entities of those types from the text and all relationships among the identified entities.
 
-Steps-
1. Identify all entities. For each identified entity, extract the following information:
- entity_name: Name of the entity, capitalized
- entity_type: One of the following types: [{entity_types}]
- entity_description: Comprehensive description of the entity's attributes and activities
Format each entity as ("entity"<|><entity_name><|><entity_type><|><entity_description>)
 
2. From the entities identified in step 1, identify all pairs of (source_entity, target_entity) that are *clearly related* to each other.
For each pair of related entities, extract the following information:
- source_entity: name of the source entity, as identified in step 1
- target_entity: name of the target entity, as identified in step 1
- relationship_description: explanation as to why you think the source entity and the target entity are related to each other
- relationship_strength: a numeric score indicating strength of the relationship between the source entity and target entity
 Format each relationship as ("relationship"<|><source_entity><|><target_entity><|><relationship_description><|><relationship_strength>)
 
3. Return output in English as a single list of all the entities and relationships identified in steps 1 and 2. Use **##** as the list delimiter.
 
4. When finished, output <|COMPLETE|>
 
######################
-Examples-
######################
Example 1:
Entity_types: ORGANIZATION,PERSON
Text:
The Verdantis's Central Institution is scheduled to meet on Monday and Thursday, with the institution planning to release its latest policy decision on Thursday at 1:30 p.m. PDT, followed by a press conference where Central Institution Chair Martin Smith will take questions. Investors expect the Market Strategy Committee to hold its benchmark interest rate steady in a range of 3.5%-3.75%.
######################
Output:
("entity"<|>CENTRAL INSTITUTION<|>ORGANIZATION<|>The Central Institution is the Federal Reserve of Verdantis, which is setting interest rates on Monday and Thursday)
##
("entity"<|>MARTIN SMITH<|>PERSON<|>Martin Smith is the chair of the Central Institution)
##
("entity"<|>MARKET STRATEGY COMMITTEE<|>ORGANIZATION<|>The Central Institution committee makes key decisions about interest rates and the growth of Verdantis's money supply)
##
("relationship"<|>MARTIN SMITH<|>CENTRAL INSTITUTION<|>Martin Smith is the Chair of the Central Institution and will answer questions at a press conference<|>9)
<|COMPLETE|>

######################
Example 2:
Entity_types: ORGANIZATION
Text:
TechGlobal's (TG) stock skyrocketed in its opening day on the Global Exchange Thursday. But IPO experts warn that the semiconductor corporation's debut on the public markets isn't indicative of how other newly listed companies may perform.

TechGlobal, a formerly public company, was taken private by Vision Holdings in 2014. The well-established chip designer says it powers 85% of premium smartphones.
######################
Output:
("entity"<|>TECHGLOBAL<|>ORGANIZATION<|>TechGlobal is a stock now listed on the Global Exchange which powers 85% of premium smartphones)
##
("entity"<|>VISION HOLDINGS<|>ORGANIZATION<|>Vision Holdings is a firm that previously owned TechGlobal)
##
("relationship"<|>TECHGLOBAL<|>VISION HOLDINGS<|>Vision Holdings formerly owned TechGlobal from 2014 until present<|>5)
<|COMPLETE|>

######################
Example 3:
Entity_types: ORGANIZATION,GEO,PERSON
Text:
Five Aurelians jailed for 8 years in Firuzabad and widely regarded as hostages are on their way home to Aurelia.

The swap orchestrated by Quintara was finalized when $8bn of Firuzi funds were transferred to financial institutions in Krohaara, the capital of Quintara.

The exchange initiated in Firuzabad's capital, Tiruzia, led to the four men and one woman, who are also Firuzi nationals, boarding a chartered flight to Krohaara.

They were welcomed by senior Aurelian officials and are now on their way to Aurelia's capital, Cashion.

The Aurelians include 39-year-old businessman Samuel Namara, who has been held in Tiruzia's Alhamia Prison, as well as journalist Durke Bataglani, 59, and environmentalist Meggie Tazbah, 53, who also holds Bratinas nationality.
######################
Output:
("entity"<|>FIRUZABAD<|>GEO<|>Firuzabad held Aurelians as hostages)
##
("entity"<|>AURELIA<|>GEO<|>Country seeking to release hostages)
##
("entity"<|>QUINTARA<|>GEO<|>Country that negotiated a swap of money in exchange for hostages)
##
##
("entity"<|>TIRUZIA<|>GEO<|>Capital of Firuzabad where the Aurelians were being held)
##
("entity"<|>KROHAARA<|>GEO<|>Capital city in Quintara)
##
("entity"<|>CASHION<|>GEO<|>Capital city in Aurelia)
##
("entity"<|>SAMUEL NAMARA<|>PERSON<|>Aurelian who spent time in Tiruzia's Alhamia Prison)
##
("entity"<|>ALHAMIA PRISON<|>GEO<|>Prison in Tiruzia)
##
("entity"<|>DURKE BATAGLANI<|>PERSON<|>Aurelian journalist who was held hostage)
##
("entity"<|>MEGGIE TAZBAH<|>PERSON<|>Bratinas national and environmentalist who was held hostage)
##
("relationship"<|>FIRUZABAD<|>AURELIA<|>Firuzabad negotiated a hostage exchange with Aurelia<|>2)
##
("relationship"<|>QUINTARA<|>AURELIA<|>Quintara brokered the hostage exchange between Firuzabad and Aurelia<|>2)
##
("relationship"<|>QUINTARA<|>FIRUZABAD<|>Quintara brokered the hostage exchange between Firuzabad and Aurelia<|>2)
##
("relationship"<|>SAMUEL NAMARA<|>ALHAMIA PRISON<|>Samuel Namara was a prisoner at Alhamia prison<|>8)
##
("relationship"<|>SAMUEL NAMARA<|>MEGGIE TAZBAH<|>Samuel Namara and Meggie Tazbah were exchanged in the same hostage release<|>2)
##
("relationship"<|>SAMUEL NAMARA<|>DURKE BATAGLANI<|>Samuel Namara and Durke Bataglani were exchanged in the same hostage release<|>2)
##
("relationship"<|>MEGGIE TAZBAH<|>DURKE BATAGLANI<|>Meggie Tazbah and Durke Bataglani were exchanged in the same hostage release<|>2)
##
("relationship"<|>SAMUEL NAMARA<|>FIRUZABAD<|>Samuel Namara was a hostage in Firuzabad<|>2)
##
("relationship"<|>MEGGIE TAZBAH<|>FIRUZABAD<|>Meggie Tazbah was a hostage in Firuzabad<|>2)
##
("relationship"<|>DURKE BATAGLANI<|>FIRUZABAD<|>Durke Bataglani was a hostage in Firuzabad<|>2)
<|COMPLETE|>

######################
-Real Data-
######################
Entity_types: {entity_types}
Text: {input_text}
######################
Output:
```

### T1 graphrag `CONTINUE_PROMPT` (second request, after the model's first answer)

```text
MANY entities and relationships were missed in the last extraction. Remember to ONLY emit entities that match any of the previously extracted types. Add them below using the same format:
```

### T2 haystack faithfulness template (jinja2, rendered like haystack's PromptBuilder)

```text
Instructions:
Your task is to judge the faithfulness or groundedness of statements based on context information. First, please extract statements from a provided predicted answer to a question. Second, calculate a faithfulness score for each statement made in the predicted answer. The score is 1 if the statement can be inferred from the provided context or 0 if it cannot be inferred.

Generate the response in JSON format with the following keys:
["statements", "statement_scores"]
Consider the instructions and the examples below to determine those values.

Examples:
Inputs:
{"questions": "What is the capital of Germany and when was it founded?", "contexts": ["Berlin is the capital of Germany and was founded in 1244."], "predicted_answers": "The capital of Germany, Berlin, was founded in the 13th century."}
Outputs:
{"statements": ["Berlin is the capital of Germany.", "Berlin was founded in 1244."], "statement_scores": [1, 1]}
Inputs:
{"questions": "What is the capital of France?", "contexts": ["Berlin is the capital of Germany."], "predicted_answers": "Paris"}
Outputs:
{"statements": ["Paris is the capital of France."], "statement_scores": [0]}
Inputs:
{"questions": "What is the capital of Italy?", "contexts": ["Rome is the capital of Italy."], "predicted_answers": "Rome is the capital of Italy with more than 4 million inhabitants."}
Outputs:
{"statements": ["Rome is the capital of Italy.", "Rome has more than 4 million inhabitants."], "statement_scores": [1, 0]}

Inputs:
{"questions": {{ questions }}, "contexts": {{ contexts }}, "predicted_answers": {{ predicted_answers }}}
Outputs:
```

### T3 llamaindex `CHAT_TEXT_QA_PROMPT` system message

```text
You are an expert Q&A system that is trusted around the world.
Always answer the query using the provided context information, and not prior knowledge.
Some rules to follow:
1. Never directly reference the given context in your answer.
2. Avoid statements like 'Based on the context, ...' or 'The context information ...' or anything along those lines.
```

### T3 llamaindex `CHAT_TEXT_QA_PROMPT` user message

```text
Context information is below.
---------------------
{context_str}
---------------------
Given the context information and not prior knowledge, answer the query.
Query: {query_str}
Answer: 
```
