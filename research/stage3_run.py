import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import llm
import tasks

ROOT = Path(__file__).resolve().parent
LADDER = ["gpt-4.1", "gpt-5.6-terra", "gpt-4.1-mini", "gpt-4o-mini", "gpt-6-luna", "gpt-5-nano",
          "claude-sonnet-5-5", "claude-haiku-5-5", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"]


def one(task, model, item):
    t0 = time.time()
    try:
        out = tasks.RUN[task](model, item)
    except llm.BudgetExceeded:
        raise
    except Exception as e:
        return {"id": item["id"], "model": model, "error": f"{type(e).__name__}: {str(e)[:300]}"}
    calls = out["calls"]
    return {
        "id": item["id"], "model": model, "text": out["text"],
        "input_tokens": sum(c["input_tokens"] for c in calls),
        "output_tokens": sum(c["output_tokens"] for c in calls),
        "reasoning_tokens": sum(c.get("reasoning_tokens") or 0 for c in calls),
        "cost_usd": sum(c["cost_usd"] for c in calls),
        "latency_s": sum(c["latency_s"] for c in calls),
        "finish": [c["finish"] for c in calls],
        "served_model": calls[0]["served_model"],
        "score": tasks.SCORE[task](item, out),
        "wall_s": round(time.time() - t0, 3),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("task", choices=["t1", "t2", "t3"])
    ap.add_argument("split", choices=["pilot", "main"])
    ap.add_argument("--models", default=",".join(LADDER))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    items = tasks.load(tasks.DATA[a.task], a.split)
    if a.limit:
        items = items[:a.limit]
    models = a.models.split(",")
    jobs = [(m, it) for m in models for it in items]
    rows = []
    with ThreadPoolExecutor(a.workers) as ex:
        for r in ex.map(lambda j: one(a.task, j[0], j[1]), jobs):
            rows.append(r)
    out = ROOT / "results" / "raw" / f"{a.task}_{a.split}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    keep = {}
    if out.exists():
        for l in out.read_text().splitlines():
            r = json.loads(l)
            keep[(r["model"], r["id"])] = r
    for r in rows:
        keep[(r["model"], r["id"])] = r
    out.write_text("\n".join(json.dumps(r) for r in keep.values()) + "\n")
    for m in models:
        mr = [r for r in rows if r["model"] == m]
        ok = [r for r in mr if "error" not in r]
        c = sum(r["cost_usd"] for r in ok)
        print(f"{m:24s} n={len(ok)}/{len(mr)} cost=${c:.4f} per_item=${c / max(len(ok), 1):.5f} "
              f"in={sum(r['input_tokens'] for r in ok) / max(len(ok), 1):.0f} out={sum(r['output_tokens'] for r in ok) / max(len(ok), 1):.0f}")
        for r in mr:
            if "error" in r:
                print("   ERR", r["id"], r["error"][:200])
    print("total spend so far:", round(llm.spent(), 4))


if __name__ == "__main__":
    main()
