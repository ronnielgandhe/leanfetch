import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LABEL = {"t1": "typed F1", "t2": "balanced acc", "t3": "containment"}
SEC = {"t1": ("untyped_f1", "untyped F1"), "t2": ("hallucination_recall", "hallucinations caught"), "t3": ("token_f1", "token F1")}


def table(t):
    r = json.loads((ROOT / "results" / f"{t}_main.json").read_text())
    k, kl = SEC[t]
    lines = [f"| model | {LABEL[t]} [95% ci] | diff vs default [99.44% ci] | {kl} | usd per 1M calls | cost vs default | in / out tokens | verdict |",
             "|---|---|---|---|---|---|---|---|"]
    for m, e in sorted(r["models"].items(), key=lambda kv: kv[1]["cost"]["usd_per_call"]):
        v, c = e.get("vs_repo"), e["cost"]
        name = f"**{m} (default)**" if not v else m
        diff = "-" if not v else f"{v['diff']:+.3f} [{v['diff_ci_decision'][0]:+.3f}, {v['diff_ci_decision'][1]:+.3f}]"
        ratio = "1x" if not v else f"{v['cost_ratio']:.2f}x"
        verdict = "default" if not v else ("strictly better + cheaper" if v["qualifies"] and v["strictly_better"] else "non-inferior + cheaper" if v["qualifies"] else "non-inferior, not 2x cheaper" if v["non_inferior"] else "not shown non-inferior")
        lines.append(f"| {name} | {e['primary']:.3f} [{e['primary_ci95'][0]:.3f}, {e['primary_ci95'][1]:.3f}] | {diff} | {e['secondary'][k]:.3f} | ${c['usd_per_1m_calls']:,.0f} | {ratio} | {c['mean_input_tokens']:,.0f} / {c['mean_output_tokens']:,.0f} | {verdict} |")
    return "\n".join(lines)


if __name__ == "__main__":
    for t in sys.argv[1:] or ["t1", "t2", "t3"]:
        print(f"\n{t}\n" + table(t))
