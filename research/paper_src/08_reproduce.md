## how to reproduce

everything is in `research/` on the `model-fit` branch of leanfetch.

```bash
cd research
export OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GOOGLE_API_KEY=...
./run_all.sh
```

that runs, in order: pin and scan the repos (`stage1_targets.sh`, `callsites/extract.ts`, `callsites/classify.py`), check the default models still answer (`stage1b_defaults_alive.py`), build the seeded samples (`stage2_data.py`), replay every call (`stage3_run.py t3|t2|t1 main`), score and bootstrap (`stage4_analyze.py`), draw the charts (`stage5_charts.py`) and the appendix (`stage6_appendix.py`). `stage7_spend.py` re-adds the cost of every cached response as a check on `spend.json`.

every model response is cached under `cache/<stage>/<model>/<sha256 of the request>.json` with the request, the raw text, token counts, latency and cost, and it's committed. so rerunning the analysis costs nothing and gives the same numbers; deleting `cache/` and rerunning re-buys the data. requests are stored without any auth headers. the samples are seeded (20261122), the bootstrap is seeded (7).

the scan step works on any repo: `../node_modules/.bin/jiti callsites/extract.ts <checkout> out.json <label>`.
