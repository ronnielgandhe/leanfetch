everyone inherits their framework's default model. so i checked if the defaults are actually right.

i pointed leanfetch at a few big repos, pulled out what each llm call is for, then replayed the exact prompts on public data with real answers. ten models, three providers, rules written down before the runs.

the clearest one: graphrag (36.7k stars) defaults to gpt-4.1 for entity extraction. on Few-NERD, gpt-6-luna, same provider, got 7.7 more F1 points (99.44% ci +5.3 to +10.5) at 7% of the cost. that's $1,755 vs $24,049 per million documents. 6 of the 7 cheaper models i tried beat the default.

the default isn't always wrong though. haystack's judge on gpt-5.6-terra held up, and llamaindex's gpt-4o-mini default was already the right call.

two things i didn't expect: graphrag's "you missed MANY entities" second pass made gpt-4.1 worse, and a cheap reasoning model can cost more per call than a pricier one once you count its thinking tokens.

paper, code and every raw output: [link]

total api spend: 12.81 usd.
