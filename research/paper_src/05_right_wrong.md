## where the repos were right

- **haystack (T2).** gpt-5.6-terra was the second best judge of the ten on balanced accuracy and nothing cheaper cleared the bar. the line was changed on purpose a month before this snapshot (`fix!: move OpenAI chat generators to gpt-5.6-terra`, 2026-10-26), and on this job it holds up. the only caveat is gpt-6-luna tying it at 6% of the cost, which isn't enough to call, but is enough to test.
- **llamaindex responses default (T3).** gpt-4o-mini is near the bottom of the price ladder already and the only two cheaper models scored lower. if anything this default under-spends: claude-haiku-5-5 is +8.7 points for 1.8x the price. defaulting to a cheap model was the right call here.

## where it was wrong, and by how much

- **graphrag (T1).** gpt-4.1 at $24,049 per million documents, beaten on typed F1 by six of the seven cheaper models with the whole decision interval above zero. careful with the fix, though: `DEFAULT_COMPLETION_MODEL` feeds every llm step in graphrag (graph extraction, claims, description summaries, community reports, and all four search modes), and i only measured extraction. so the honest one-line fix is scoped to extraction. graphrag's `settings.yaml` already lets each step pick its own model, so it's one extra model entry plus one line:

  ```yaml
  completion_models:
    extract_model:
      model_provider: openai
      model: gpt-6-luna
  extract_graph:
    completion_model_id: extract_model
  ```

  on this data that takes extraction to $1,755 per million documents and +7.7 F1 points. a second line worth testing is `max_gleanings: 0` under `extract_graph`, which halves the cost again and, on this data, helps most models. whether gpt-6-luna is also fine for community reports or search is a separate question i didn't test.
- **llamaindex `OpenAI` default (not benchmarked).** `DEFAULT_OPENAI_MODEL = "gpt-3.5-turbo"` points at a model openai shut down on 2026-10-23. the fix is any live model id; given T3, `gpt-4o-mini` (the default the same package already uses for `OpenAIResponses`) is a sensible one.

none of this says anything about the maintainers. graphrag's default was set in a big v3 rewrite in january; picking a strong general model for a pipeline that has to work out of the box is a reasonable instinct. it just turns out the narrow job doesn't need it, and the second pass actively hurts it.
