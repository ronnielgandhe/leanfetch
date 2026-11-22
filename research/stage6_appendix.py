import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import prompts

ROOT = Path(__file__).resolve().parent


def fence(s):
    return "```text\n" + s.rstrip("\n") + "\n```\n"


def main():
    prices = json.loads((ROOT / "prices.json").read_text())
    targets = json.loads((ROOT / "targets.json").read_text())
    alive = json.loads((ROOT / "results/defaults_alive.json").read_text())
    served = {}
    for t in ("t1", "t2", "t3"):
        for l in (ROOT / "results/raw" / f"{t}_main.jsonl").read_text().splitlines():
            r = json.loads(l)
            if "served_model" in r:
                served.setdefault(r["model"], set()).add(r["served_model"])
    out = ["## appendix a: model ids and prices", "",
           f"prices checked against the live provider pages on {prices['verified_on']}. usd per 1M tokens, standard tier, no caching, no batch.", "",
           "| model id (requested) | served as | input | output |", "|---|---|---|---|"]
    for m, p in prices["models"].items():
        if m == "gpt-3.5-turbo":
            continue
        out.append(f"| `{m}` | {', '.join(f'`{s}`' for s in sorted(served.get(m, []))) or '-'} | ${p['input']:.2f} | ${p['output']:.2f} |")
    out += ["", "sources: " + ", ".join(f"{k}: {v}" for k, v in prices["sources"].items()), "",
            "## appendix b: target commits", "", "| repo | commit | url |", "|---|---|---|"]
    for k, v in targets["repos"].items():
        out.append(f"| {k} | `{v['sha']}` | {v['url']} |")
    out += ["", "default-model liveness check (`results/defaults_alive.json`):", "", "| repo | line | model | result |", "|---|---|---|---|"]
    for a in alive:
        out.append(f"| {a['repo']} | `{a['line']}` | `{a['model']}` | {a['status']}{(': ' + a['error'][:90]) if a['status'] == 'error' else ''} |")
    out += ["", "## appendix c: exact prompts", "",
            "pulled at run time from the pinned checkouts with `ast` (see `lib/prompts.py`), so these are byte-for-byte the repo strings.", "",
            "### T1 graphrag `GRAPH_EXTRACTION_PROMPT` (first request; `{entity_types}` = `organization,person,geo,event`)", "",
            fence(prompts.GRAPH_EXTRACTION_PROMPT), "### T1 graphrag `CONTINUE_PROMPT` (second request, after the model's first answer)", "",
            fence(prompts.CONTINUE_PROMPT), "### T2 haystack faithfulness template (jinja2, rendered like haystack's PromptBuilder)", "",
            fence(prompts.haystack_faithfulness_template()), "### T3 llamaindex `CHAT_TEXT_QA_PROMPT` system message", "",
            fence(prompts.TEXT_QA_SYSTEM_PROMPT), "### T3 llamaindex `CHAT_TEXT_QA_PROMPT` user message", "", fence(prompts.TEXT_QA_USER_TMPL)]
    (ROOT / "results" / "appendix.md").write_text("\n".join(out))
    print("wrote results/appendix.md")


if __name__ == "__main__":
    main()
