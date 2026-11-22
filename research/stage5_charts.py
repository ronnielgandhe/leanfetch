import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "charts"
INK, MID, LIGHT, RULE, BG = "#1A1A1A", "#6B7280", "#9CA3AF", "#E5E7EB", "#FFFFFF"
FONT = "Manrope, -apple-system, Helvetica, Arial, sans-serif"
SHORT = {
    "gpt-4.1": "gpt-4.1", "gpt-5.6-terra": "gpt-5.6-terra", "gpt-4.1-mini": "gpt-4.1-mini", "gpt-4o-mini": "gpt-4o-mini",
    "gpt-6-luna": "gpt-6-luna", "gpt-5-nano": "gpt-5-nano", "claude-sonnet-5-5": "sonnet-5.5", "claude-haiku-5-5": "haiku-5.5",
    "gemini-3.1-flash-lite": "gemini-3.1-fl", "gemini-2.5-flash-lite": "gemini-2.5-fl",
}


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, s, size=12, fill=INK, anchor="start", weight=400, halo=False):
    h = f' stroke="{BG}" stroke-width="3" paint-order="stroke"' if halo else ""
    return f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{h}>{esc(s)}</text>'


def line(x1, y1, x2, y2, stroke=RULE, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" stroke-width="1"{d}/>'


def scatter(res, path, ylabel):
    W, H, L, R, T, Bm = 760, 460, 70, 30, 70, 60
    pw, ph = W - L - R, H - T - Bm
    ms = res["models"]
    xs = {m: e["cost"]["usd_per_1m_calls"] for m, e in ms.items()}
    lo_x = 10 ** math.floor(math.log10(min(xs.values())))
    hi_x = 10 ** math.ceil(math.log10(max(xs.values())))
    ys = [v for e in ms.values() for v in e["primary_ci95"]]
    lo_y = math.floor(min(ys) * 20) / 20
    hi_y = min(1.0, math.ceil(max(ys) * 20) / 20)

    def X(v):
        return L + (math.log10(v) - math.log10(lo_x)) / (math.log10(hi_x) - math.log10(lo_x)) * pw

    def Y(v):
        return T + (hi_y - v) / (hi_y - lo_y) * ph

    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         f'<rect width="{W}" height="{H}" fill="{BG}"/>',
         text(L, 28, f"{res['repo']}: {res['job']}", 15, INK, weight=600),
         text(L, 48, f"{res['dataset']}, n = {res['n']}. dots = point estimate, bars = 95% bootstrap ci. black = repo default.", 11, MID)]
    k = lo_y
    while k <= hi_y + 1e-9:
        s += [line(L, Y(k), L + pw, Y(k)), text(L - 8, Y(k) + 4, f"{k:.2f}", 10, MID, "end")]
        k = round(k + 0.05, 2)
    e10 = int(math.log10(lo_x))
    while 10 ** e10 <= hi_x:
        v = 10 ** e10
        s += [line(X(v), T, X(v), T + ph), text(X(v), T + ph + 16, f"${v:,.0f}" if v >= 1 else f"${v:g}", 10, MID, "middle")]
        e10 += 1
    s += [line(L, T + ph, L + pw, T + ph, INK), line(L, T, L, T + ph, INK)]
    s.append(text(L + pw / 2, H - 14, "usd per 1 million calls (log scale, measured tokens x list price)", 11, MID, "middle"))
    s.append(f'<text transform="translate(18,{T + ph / 2:.1f}) rotate(-90)" font-family="{FONT}" font-size="11" fill="{MID}" text-anchor="middle">{esc(ylabel)}</text>')
    repo = res["repo_model"]
    ry = ms[repo]["primary"]
    s.append(line(L, Y(ry - res["delta"]), L + pw, Y(ry - res["delta"]), LIGHT, "3,3"))
    s.append(text(L + pw - 4, Y(ry - res["delta"]) - 5, f"repo default minus {res['delta']:.2f} (non-inferiority margin)", 9, LIGHT, "end"))
    placed = []
    for m, e in sorted(ms.items(), key=lambda kv: kv[1]["cost"]["usd_per_1m_calls"]):
        x, y = X(xs[m]), Y(e["primary"])
        a, b = e["primary_ci95"]
        is_repo = m == repo
        col = INK if is_repo else MID
        s.append(line(x, Y(a), x, Y(b), col))
        s.append(line(x - 4, Y(a), x + 4, Y(a), col))
        s.append(line(x - 4, Y(b), x + 4, Y(b), col))
        if is_repo:
            s.append(f'<rect x="{x - 5:.1f}" y="{y - 5:.1f}" width="10" height="10" fill="{INK}"/>')
        else:
            s.append(f'<rect x="{x - 4:.1f}" y="{y - 4:.1f}" width="8" height="8" fill="{BG}" stroke="{INK}" stroke-width="1"/>')
        ly = y - 10
        while any(abs(ly - py) < 12 and abs(x - px) < 90 for px, py in placed):
            ly -= 12
        placed.append((x, ly))
        s.append(text(x + 8, ly, SHORT.get(m, m), 10, INK if is_repo else MID, weight=600 if is_repo else 400, halo=True))
    s.append("</svg>")
    path.write_text("\n".join(s))


def forest(results, path):
    rows = []
    for res in results:
        repo = res["repo_model"]
        rows.append(("head", f"{res['repo']} ({res['metric']}), default {repo}", None))
        for m, e in sorted(res["models"].items(), key=lambda kv: kv[1]["cost"]["usd_per_call"]):
            if m == repo:
                continue
            rows.append(("row", m, e["vs_repo"]))
    W, rh, L, R, T = 760, 18, 260, 140, 56
    H = T + rh * len(rows) + 50
    lo, hi = -0.30, 0.30
    pw = W - L - R

    def X(v):
        return L + (max(lo, min(hi, v)) - lo) / (hi - lo) * pw

    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         f'<rect width="{W}" height="{H}" fill="{BG}"/>',
         text(20, 26, "alternative minus repo default, primary metric", 15, INK, weight=600),
         text(20, 44, "bars = 99.44% paired bootstrap interval (the decision interval). dashed = -0.03 margin. right column = cost vs default.", 11, MID)]
    y = T
    for v in (-0.3, -0.2, -0.1, 0.0, 0.1, 0.2, 0.3):
        s.append(line(X(v), T, X(v), T + rh * len(rows), INK if v == 0 else RULE))
        s.append(text(X(v), T + rh * len(rows) + 16, f"{v:+.1f}" if v else "0", 10, MID, "middle"))
    s.append(line(X(-0.03), T, X(-0.03), T + rh * len(rows), LIGHT, "3,3"))
    for kind, label, v in rows:
        if kind == "head":
            s.append(text(20, y + 13, label, 11, INK, weight=600))
        else:
            a, b = v["diff_ci_decision"]
            q = v["qualifies"]
            col = INK if q else LIGHT
            s.append(text(36, y + 13, SHORT.get(label, label), 11, INK if q else MID))
            s.append(line(X(a), y + 9, X(b), y + 9, col))
            s.append(f'<rect x="{X(v["diff"]) - 3:.1f}" y="{y + 6:.1f}" width="6" height="6" fill="{col}"/>')
            s.append(text(W - R + 12, y + 13, f"{v['cost_ratio']:.2f}x cost" + ("  qualifies" if q else ""), 10, INK if q else MID))
        y += rh
    s.append("</svg>")
    path.write_text("\n".join(s))


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    labels = {"t1": "typed entity micro-F1", "t2": "balanced accuracy", "t3": "answer containment accuracy"}
    results = []
    for t in ("t1", "t2", "t3"):
        p = ROOT / "results" / f"{t}_main.json"
        if p.exists():
            res = json.loads(p.read_text())
            results.append(res)
            scatter(res, OUT / f"{t}_price_vs_quality.svg", labels[t])
    if results:
        forest(results, OUT / "forest_vs_default.svg")
    print("charts:", sorted(x.name for x in OUT.glob("*.svg")))
