# deviations from PREREGISTRATION.md

logged as they happened. none of them were decided from quality numbers.

1. **T1 pilot cut to 2 documents (not 20).** the 2-document check cost 0.12 usd per document across the 10-model ladder (graphrag sends two long requests per document). 18 more pilot documents would have spent about 2.2 usd on plumbing only. the 2 documents confirmed that every model returns parseable graphrag records. pilot documents are not in the main sample.
2. **T1 main n = 150, not 200.** this is the preregistered budget rule: projected main cost at n = 200 was about 24.5 usd for T1 alone. at n = 150 the projected total for the whole study was about 21.7 usd, under the 25 usd cap, so no model was dropped at that point. the first 150 main documents are used.
3. **gemini calls use the v1beta endpoint.** the v1 endpoint rejects system instructions and json mode. same models, same prompts.
4. **analysis code was run on pilot data for T2 and T3 after the preregistration commit** to check that it works. pilot quality numbers were therefore visible before the main runs. the margin, metrics and decision rule were already committed and were not changed.
