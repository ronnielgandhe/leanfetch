import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
import llm

ROOT = Path(__file__).resolve().parent.parent
MODEL = "claude-haiku-5-5"
TASKS = [
    "classification_routing", "extraction_structured", "summarization", "query_rewriting",
    "rag_answer", "code_generation", "tool_selection", "grading_judging", "reranking", "chat_open_ended", "other",
]
SYSTEM = (
    "You label LLM prompt templates found in source code by the job the call does. "
    "Reply with one JSON object only, no prose, with keys: "
    f"task (one of {TASKS}), output_format (free_text|json|delimited|label|score), "
    "benchmark_analogue (one well known public dataset whose task matches this job, or 'none'), "
    "metric (the objective metric that dataset uses), rationale (one sentence)."
)


def parse(text):
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else None


def main():
    out = {}
    for f in sorted((ROOT / "results/callsites").glob("*.json")):
        if f.name.endswith(".classified.json"):
            continue
        d = json.loads(f.read_text())
        rows = []
        for t in d["promptTemplates"]:
            user = f"file: {t['file']}\nname: {t['name']}\nplaceholders: {t['placeholders']}\n---\n{t['value'][:6000]}"
            r = llm.complete("classify", MODEL, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
                             {"max_tokens": 2000, "output_config": {"effort": "low"}}, est_out=400)
            try:
                lab = parse(r["text"])
            except json.JSONDecodeError:
                lab = None
            rows.append({k: t[k] for k in ("file", "line", "name", "chars", "placeholders")} | {"label": lab})
        res = {"repo": d["repo"], "modelDefaults": d["modelDefaults"], "callSites": d["callSites"], "templates": rows}
        (ROOT / "results/callsites" / f"{f.stem}.classified.json").write_text(json.dumps(res, indent=1))
        counts = {}
        for r in rows:
            k = (r["label"] or {}).get("task", "unparsed")
            counts[k] = counts.get(k, 0) + 1
        out[d["repo"]] = counts
        print(d["repo"], counts)
    (ROOT / "results/callsites/summary.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
