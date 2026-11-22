import json
import random
from pathlib import Path

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data/raw"
OUT = ROOT / "data"
SEED = 20261122
COARSE = ["O", "art", "building", "event", "location", "organization", "other", "person", "product"]


def spans(tokens, tags):
    out, i = [], 0
    while i < len(tokens):
        t = tags[i]
        if t == 0:
            i += 1
            continue
        j = i
        while j + 1 < len(tokens) and tags[j + 1] == t:
            j += 1
        out.append({"text": " ".join(tokens[i:j + 1]), "type": COARSE[t]})
        i = j + 1
    return out


def detok(tokens):
    s = " ".join(tokens)
    for a, b in [(" ,", ","), (" .", "."), (" ;", ";"), (" :", ":"), (" 's", "'s"), ("( ", "("), (" )", ")"), (" ?", "?"), (" !", "!"), ("`` ", '"'), (" ``", ' "'), (" ''", '"')]:
        s = s.replace(a, b)
    return s


def t1():
    rows = pq.read_table(RAW / "fewnerd_test.parquet").to_pylist()
    idx = list(range(len(rows)))
    random.Random(SEED).shuffle(idx)
    docs = []
    for d in range(220):
        sents = [rows[i] for i in idx[d * 6:(d + 1) * 6]]
        gold = [s for r in sents for s in spans(r["tokens"], r["ner_tags"])]
        docs.append({"id": f"fn-{d}", "split": "pilot" if d < 20 else "main", "text": " ".join(detok(r["tokens"]) for r in sents),
                     "sentence_ids": [r["id"] for r in sents], "gold": gold})
    return docs


def t2():
    rows = [json.loads(l) for l in (RAW / "halueval_qa.json").read_text().splitlines() if l.strip()]
    idx = list(range(len(rows)))
    random.Random(SEED).shuffle(idx)
    out = []
    for split, chunk in [("pilot", idx[:20]), ("main", idx[20:320])]:
        half = len(chunk) // 2
        for k, i in enumerate(chunk):
            r = rows[i]
            faithful = k < half
            out.append({"id": f"he-{i}", "split": split, "question": r["question"], "contexts": [r["knowledge"]],
                        "predicted_answer": r["right_answer"] if faithful else r["hallucinated_answer"], "label": int(faithful)})
    return out


def t3():
    rows = pq.read_table(RAW / "hotpot_dev_distractor.parquet").to_pylist()
    idx = list(range(len(rows)))
    rng = random.Random(SEED)
    rng.shuffle(idx)
    out = []
    for k, i in enumerate(idx[:320]):
        r = rows[i]
        titles = list(dict.fromkeys(r["supporting_facts"]["title"]))
        paras = []
        for t in titles:
            j = r["context"]["title"].index(t)
            paras.append(f"title: {t}\n\n" + "".join(r["context"]["sentences"][j]).strip())
        rng.shuffle(paras)
        out.append({"id": r["id"], "split": "pilot" if k < 20 else "main", "question": r["question"], "answer": r["answer"],
                    "type": r["type"], "level": r["level"], "context_str": "\n\n".join(paras)})
    return out


def write(name, rows):
    (OUT / name).write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    print(name, len(rows), sum(r["split"] == "main" for r in rows), "main")


if __name__ == "__main__":
    write("t1_fewnerd.jsonl", t1())
    write("t2_halueval.jsonl", t2())
    write("t3_hotpot.jsonl", t3())
