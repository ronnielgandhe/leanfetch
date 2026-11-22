import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
by_stage, by_model, calls = {}, {}, 0
for f in (ROOT / "cache").glob("*/*/*.json"):
    r = json.loads(f.read_text())
    stage, model = f.parent.parent.name, f.parent.name
    by_stage[stage] = by_stage.get(stage, 0) + r["cost_usd"]
    by_model[model] = by_model.get(model, 0) + r["cost_usd"]
    calls += 1
led = json.loads((ROOT / "spend.json").read_text())
led["recomputed_from_cache"] = {
    "note": "sum of cost_usd over every cached response; excludes the 5 uncached liveness calls in stage1b (logged in total_usd)",
    "total_usd": round(sum(by_stage.values()), 4), "calls": calls,
    "by_stage": {k: round(v, 4) for k, v in sorted(by_stage.items())},
    "by_model": {k: round(v, 4) for k, v in sorted(by_model.items(), key=lambda kv: -kv[1])},
}
(ROOT / "spend.json").write_text(json.dumps(led, indent=2))
print(json.dumps(led["recomputed_from_cache"], indent=1))
