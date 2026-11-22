import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import tasks

ROOT = Path(__file__).resolve().parent
B, SEED = 10_000, 7


def counts(item, text):
    gold = {(tasks.norm_name(g["text"]), g["type"]) for g in item["gold"] if g["type"] in tasks.TARGET_TYPES}
    gnames = {g[0] for g in gold}
    excl = {tasks.norm_name(g["text"]) for g in item["gold"] if g["type"] not in tasks.TARGET_TYPES}
    src = " " + tasks.norm_name(item["text"]) + " "
    pred, ignored = set(), 0
    for name, typ in tasks.graphrag_entities(text):
        if typ not in tasks.TYPE_MAP:
            continue
        n = tasks.norm_name(name)
        if not n or (n in excl and n not in gnames):
            continue
        if n not in gnames and f" {n} " in src:
            ignored += 1
            continue
        pred.add((n, tasks.TYPE_MAP[typ]))
    tp = len(pred & gold)
    return [tp, len(pred) - tp, len(gold) - tp, ignored]


def f1(a, idx):
    tp, fp, fn = a[idx, 0].sum(), a[idx, 1].sum(), a[idx, 2].sum()
    return 2 * tp / (2 * tp + fp + fn)


def main():
    res = json.loads((ROOT / "results/t1_main.json").read_text())
    repo = res["repo_model"]
    items = tasks.load("t1_fewnerd.jsonl", "main")[: res["n"]]
    raw = {}
    for l in (ROOT / "results/raw/t1_main.jsonl").read_text().splitlines():
        r = json.loads(l)
        raw[(r["model"], r["id"])] = r.get("text", "")
    arr = {m: np.array([counts(it, raw.get((m, it["id"]), "")) for it in items], float) for m in res["models"]}
    rng = np.random.default_rng(SEED)
    boot = rng.integers(0, len(items), size=(B, len(items)))
    full = np.arange(len(items))
    base = np.array([f1(arr[repo], b) for b in boot])
    out = {"note": "exploratory sensitivity, not preregistered and deliberately generous to models that extract more: a predicted name that is not a gold "
                   "entity but appears verbatim in the source text is ignored (neither true nor false positive), in case Few-NERD simply missed it.",
           "n": len(items), "models": {}}
    for m, a in arr.items():
        e = {"f1_unlabelled_verbatim_ignored": f1(a, full), "ignored_per_doc": float(a[:, 3].mean())}
        if m != repo:
            d = np.array([f1(a, b) for b in boot]) - base
            e["diff_vs_default"] = e["f1_unlabelled_verbatim_ignored"] - f1(arr[repo], full)
            e["diff_ci_99_44"] = [float(np.percentile(d, 0.278)), float(np.percentile(d, 99.722))]
        out["models"][m] = e
        print(m, {k: (round(v, 3) if isinstance(v, float) else [round(x, 3) for x in v]) for k, v in e.items()})
    (ROOT / "results/t1_exploratory_unlabelled.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
