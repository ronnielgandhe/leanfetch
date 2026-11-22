import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import llm

ROOT = Path(__file__).resolve().parent
B = 10_000
SEED = 7
DELTA = 0.03
ALPHA_DECISION = 0.05 / 9
REPO_MODEL = {"t1": "gpt-4.1", "t2": "gpt-5.6-terra", "t3": "gpt-4o-mini"}
META = {
    "t1": {"repo": "microsoft/graphrag", "job": "entity + relationship extraction", "dataset": "Few-NERD (supervised test)", "metric": "typed entity micro-F1"},
    "t2": {"repo": "deepset-ai/haystack", "job": "faithfulness judging", "dataset": "HaluEval QA", "metric": "balanced accuracy"},
    "t3": {"repo": "run-llama/llama_index", "job": "rag answer", "dataset": "HotpotQA distractor (gold paragraphs)", "metric": "answer containment accuracy"},
}


def load(task, split):
    rows = [json.loads(l) for l in (ROOT / "results/raw" / f"{task}_{split}.jsonl").read_text().splitlines() if l.strip()]
    by = {}
    for r in rows:
        by.setdefault(r["model"], {})[r["id"]] = r
    return by


def item_arrays(task, rows, ids):
    if task == "t1":
        keys = ["tp", "fp", "fn", "utp", "ufp", "ufn"]
        return {k: np.array([rows[i]["score"][k] if i in rows and "score" in rows[i] else (0 if k[-2:] != "fn" else None) for i in ids], dtype=float) for k in keys}
    if task == "t2":
        label = np.array([rows[i]["score"]["label"] if "score" in rows.get(i, {}) else np.nan for i in ids])
        corr = np.array([rows[i]["score"]["correct"] if "score" in rows.get(i, {}) else 0 for i in ids], dtype=float)
        corr_l = np.array([rows[i]["score"]["correct_lenient"] if "score" in rows.get(i, {}) else 0 for i in ids], dtype=float)
        pf = np.array([rows[i]["score"]["parse_fail"] if "score" in rows.get(i, {}) else 1 for i in ids], dtype=float)
        return {"correct": corr, "correct_lenient": corr_l, "parse_fail": pf}
    corr = np.array([rows[i]["score"]["correct"] if "score" in rows.get(i, {}) else 0 for i in ids], dtype=float)
    f1 = np.array([rows[i]["score"]["f1"] if "score" in rows.get(i, {}) else 0 for i in ids], dtype=float)
    return {"correct": corr, "f1": f1}


def micro_f1(tp, fp, fn):
    d = 2 * tp + fp + fn
    return 0.0 if d == 0 else 2 * tp / d


def primary(task, a, idx, labels=None):
    if task == "t1":
        return micro_f1(a["tp"][idx].sum(), a["fp"][idx].sum(), a["fn"][idx].sum())
    if task == "t2":
        c, l = a["correct"][idx], labels[idx]
        pos, neg = l == 1, l == 0
        return 0.5 * (c[pos].mean() + c[neg].mean())
    return a["correct"][idx].mean()


def secondary(task, a, idx, labels=None):
    if task == "t1":
        return {"untyped_f1": micro_f1(a["utp"][idx].sum(), a["ufp"][idx].sum(), a["ufn"][idx].sum())}
    if task == "t2":
        c, l = a["correct_lenient"][idx], labels[idx]
        return {"accuracy": a["correct"][idx].mean(), "parse_fail_rate": a["parse_fail"][idx].mean(),
                "balanced_accuracy_lenient_parse": 0.5 * (c[l == 1].mean() + c[l == 0].mean())}
    return {"token_f1": a["f1"][idx].mean()}


def mcnemar(x, y):
    b = int(((x == 1) & (y == 0)).sum())
    c = int(((x == 0) & (y == 1)).sum())
    n = b + c
    if n == 0:
        return {"b": b, "c": c, "p": 1.0}
    k = min(b, c)
    p = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return {"b": b, "c": c, "p": min(1.0, 2 * p)}


def summarize_cost(rows, ids):
    ok = [rows[i] for i in ids if i in rows and "error" not in rows[i]]
    if not ok:
        return {}
    lat = np.array([r["latency_s"] for r in ok])
    return {
        "usd_per_call": float(np.mean([r["cost_usd"] for r in ok])),
        "usd_per_1k_calls": float(np.mean([r["cost_usd"] for r in ok]) * 1e3),
        "usd_per_1m_calls": float(np.mean([r["cost_usd"] for r in ok]) * 1e6),
        "mean_input_tokens": float(np.mean([r["input_tokens"] for r in ok])),
        "mean_output_tokens": float(np.mean([r["output_tokens"] for r in ok])),
        "mean_reasoning_tokens": float(np.mean([r.get("reasoning_tokens") or 0 for r in ok])),
        "latency_median_s": float(np.median(lat)),
        "latency_p90_s": float(np.percentile(lat, 90)),
        "errors": sum(1 for i in ids if i in rows and "error" in rows[i]),
        "missing": sum(1 for i in ids if i not in rows),
    }


def analyze(task, split="main"):
    by = load(task, split)
    repo = REPO_MODEL[task]
    ids = sorted(set().union(*[set(v) for v in by.values()]))
    data = [json.loads(l) for l in (ROOT / "data" / {"t1": "t1_fewnerd.jsonl", "t2": "t2_halueval.jsonl", "t3": "t3_hotpot.jsonl"}[task]).read_text().splitlines()]
    ids = [d["id"] for d in data if d["split"] == split and d["id"] in set(ids)]
    labels = np.array([d["label"] for d in data if d["split"] == split and d["id"] in set(ids)]) if task == "t2" else None
    n = len(ids)
    if task == "t1":
        gold_n = {d["id"]: sum(1 for g in d["gold"] if g["type"] in {"person", "organization", "location", "event"}) for d in data}
        for m, rows in by.items():
            for i in ids:
                r = rows.get(i)
                if r is None or "error" in r:
                    rows[i] = {"score": {"tp": 0, "fp": 0, "fn": gold_n[i], "utp": 0, "ufp": 0, "ufn": gold_n[i]}, "error": (r or {}).get("error", "missing")}
    arrays = {m: item_arrays(task, rows, ids) for m, rows in by.items()}
    rng = np.random.default_rng(SEED)
    boot = rng.integers(0, n, size=(B, n))
    full = np.arange(n)
    base = arrays[repo]
    base_boot = np.array([primary(task, base, b, labels) for b in boot])
    models = {}
    for m, a in arrays.items():
        est = primary(task, a, full, labels)
        mb = np.array([primary(task, a, b, labels) for b in boot])
        entry = {"primary": est, "primary_ci95": [float(np.percentile(mb, 2.5)), float(np.percentile(mb, 97.5))],
                 "secondary": secondary(task, a, full, labels), "cost": summarize_cost(by[m], ids)}
        if m != repo:
            d = mb - base_boot
            diff = est - primary(task, base, full, labels)
            lo, hi = np.percentile(d, [100 * ALPHA_DECISION / 2, 100 - 100 * ALPHA_DECISION / 2])
            entry["vs_repo"] = {
                "diff": float(diff),
                "diff_ci95": [float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))],
                "diff_ci_decision": [float(lo), float(hi)],
                "non_inferior": bool(lo > -DELTA),
                "strictly_better": bool(lo > 0),
            }
            if task in ("t2", "t3"):
                entry["vs_repo"]["mcnemar"] = mcnemar(a["correct"], base["correct"])
        models[m] = entry
    rc = models[repo]["cost"]["usd_per_call"]
    for m, e in models.items():
        if m == repo:
            continue
        ratio = e["cost"]["usd_per_call"] / rc
        e["vs_repo"]["cost_ratio"] = ratio
        e["vs_repo"]["materially_cheaper"] = bool(ratio <= 0.5)
        e["vs_repo"]["usd_saved_per_1m_calls"] = (rc - e["cost"]["usd_per_call"]) * 1e6
        e["vs_repo"]["qualifies"] = bool(e["vs_repo"]["non_inferior"] and ratio <= 0.5)
    qual = [m for m, e in models.items() if m != repo and e["vs_repo"]["qualifies"]]
    verdict = "default is the wrong pick on this job and dataset" if qual else "default is defensible on this job and dataset"
    res = {"task": task, **META[task], "split": split, "n": n, "repo_model": repo, "delta": DELTA, "bootstrap": B, "seed": SEED,
           "decision_interval": f"{100 * (1 - ALPHA_DECISION):.2f}%", "verdict": verdict, "qualifying_alternatives": sorted(qual, key=lambda m: models[m]["cost"]["usd_per_call"]),
           "prices_verified_on": llm.PRICES["verified_on"], "models": models}
    out = ROOT / "results" / f"{task}_{split}.json"
    out.write_text(json.dumps(res, indent=1))
    return res


def table(res):
    print(f"\n{res['task']} {res['repo']} n={res['n']} repo={res['repo_model']} -> {res['verdict']} {res['qualifying_alternatives']}")
    for m, e in sorted(res["models"].items(), key=lambda kv: kv[1]["cost"].get("usd_per_call", 0)):
        v = e.get("vs_repo", {})
        ci = v.get("diff_ci_decision")
        print(f"  {m:24s} {e['primary']:.3f} [{e['primary_ci95'][0]:.3f},{e['primary_ci95'][1]:.3f}]  $/1k={e['cost'].get('usd_per_1k_calls', 0):.4f}"
              + (f"  diff={v['diff']:+.3f} dec[{ci[0]:+.3f},{ci[1]:+.3f}] x{v['cost_ratio']:.2f} NI={v['non_inferior']} Q={v['qualifies']}" if v else "  (repo)")
              + f"  err={e['cost'].get('errors')}")


if __name__ == "__main__":
    split = sys.argv[1] if len(sys.argv) > 1 else "main"
    for t in (sys.argv[2:] or ["t1", "t2", "t3"]):
        if (ROOT / "results/raw" / f"{t}_{split}.jsonl").exists():
            table(analyze(t, split))
