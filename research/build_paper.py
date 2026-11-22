import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    tables = {}
    for t in ("t1", "t2", "t3"):
        out = subprocess.run([str(ROOT / ".venv/bin/python"), str(ROOT / "stage8_tables.py"), t], capture_output=True, text=True, check=True).stdout
        tables[f"{t.upper()}_TABLE"] = out.split("\n", 2)[2].strip()
    t1 = json.loads((ROOT / "results/t1_main.json").read_text())
    text = "\n\n".join(p.read_text().strip() for p in sorted((ROOT / "paper_src").glob("*.md")))
    for k, v in tables.items():
        text = text.replace(k, v)
    text = text.replace("T1_COUNT", str(len(t1["qualifying_alternatives"])))
    text += "\n\n" + (ROOT / "results/appendix.md").read_text().strip() + "\n"
    (ROOT / "paper.md").write_text(text)
    print("paper.md", len(text.split()), "words")


if __name__ == "__main__":
    main()
