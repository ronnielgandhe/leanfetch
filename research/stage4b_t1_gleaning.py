import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import tasks

ROOT = Path(__file__).resolve().parent
B, SEED = 10_000, 7


def f1(a, idx):
    tp, fp, fn = a[idx, 0].sum(), a[idx, 1].sum(), a[idx, 2].sum()
    return 2 * tp / (2 * tp + fp + fn)


def main():
    res = json.loads((ROOT / "results/t1_main.json").read_text())
    ids = None
    items = [i for i in tasks.load("t1_fewnerd.jsonl", "main")][: res["n"]]
    rng = np.random.default_rng(SEED)
    boot = rng.integers(0, len(items), size=(B, len(items)))
    out = {"note": "exploratory, not preregistered: graphrag's default runs one extra 'gleaning' request (max_gleanings = 1). "
                   "this compares the first request alone against the default two-request flow, on the same documents.",
           "n": len(items), "models": {}}
    for m in res["models"]:
        first, both, c1, c2, added = [], [], 0.0, 0.0, 0
        for it in items:
            o = tasks.run_t1(m, it)
            s1 = tasks.score_t1(it, {"text": o["calls"][0]["text"]})
            s = tasks.score_t1(it, o)
            first.append([s1["tp"], s1["fp"], s1["fn"]])
            both.append([s["tp"], s["fp"], s["fn"]])
            c1 += o["calls"][0]["cost_usd"]
            c2 += o["calls"][0]["cost_usd"] + o["calls"][1]["cost_usd"]
            added += len(tasks.graphrag_entities(o["calls"][1]["text"]))
        first, both = np.array(first, float), np.array(both, float)
        full = np.arange(len(items))
        d = np.array([f1(first, b) - f1(both, b) for b in boot])
        out["models"][m] = {
            "f1_first_request_only": f1(first, full), "f1_default_with_gleaning": f1(both, full),
            "diff_first_minus_default": f1(first, full) - f1(both, full),
            "diff_ci95": [float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))],
            "usd_per_1m_docs_first_only": c1 / len(items) * 1e6, "usd_per_1m_docs_default": c2 / len(items) * 1e6,
            "entities_added_by_gleaning_per_doc": added / len(items),
        }
        print(m, {k: (round(v, 3) if isinstance(v, float) else v) for k, v in out["models"][m].items()})
    (ROOT / "results/t1_exploratory_gleaning.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
