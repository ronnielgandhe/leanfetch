import json
import re
import string
from collections import Counter
from pathlib import Path

from jinja2 import Template

import llm
import prompts

ROOT = Path(__file__).resolve().parent.parent

TEMP_OK = {"gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"}


def load(name, split):
    return [json.loads(l) for l in (ROOT / "data" / name).read_text().splitlines() if l.strip() and json.loads(l)["split"] == split]


def run_t1(model, item):
    first = prompts.GRAPH_EXTRACTION_PROMPT.format(entity_types="organization,person,geo,event", input_text=item["text"])
    params = {"max_tokens": 16000} if llm.provider(model) == "anthropic" else {}
    msgs = [{"role": "user", "content": first}]
    a = llm.complete("t1", model, msgs, params, est_out=1500)
    msgs2 = msgs + [{"role": "assistant", "content": a["text"]}, {"role": "user", "content": prompts.CONTINUE_PROMPT}]
    b = llm.complete("t1", model, msgs2, params, est_out=1000)
    return {"text": a["text"] + b["text"], "calls": [a, b]}


HAYSTACK_TEMPLATE = Template(prompts.haystack_faithfulness_template())
T2_SCHEMA = {
    "type": "object",
    "properties": {"statements": {"type": "array", "items": {"type": "string"}},
                   "statement_scores": {"type": "array", "items": {"type": "integer"}}},
    "required": ["statements", "statement_scores"],
    "additionalProperties": False,
}


def run_t2(model, item):
    prompt = HAYSTACK_TEMPLATE.render(questions=item["question"], contexts=item["contexts"], predicted_answers=item["predicted_answer"])
    p = llm.provider(model)
    if p == "openai":
        params = {"response_format": {"type": "json_object"}, "seed": 42}
    elif p == "google":
        params = {"response_mime_type": "application/json"}
    else:
        params = {"max_tokens": 16000, "output_config": {"format": {"type": "json_schema", "schema": T2_SCHEMA}}}
    r = llm.complete("t2", model, [{"role": "user", "content": prompt}], params, est_out=800)
    return {"text": r["text"], "calls": [r]}


def run_t3(model, item):
    msgs = [{"role": "system", "content": prompts.TEXT_QA_SYSTEM_PROMPT},
            {"role": "user", "content": prompts.TEXT_QA_USER_TMPL.format(context_str=item["context_str"], query_str=item["question"])}]
    p = llm.provider(model)
    params = {}
    if model in TEMP_OK:
        params["temperature"] = 0.1
    if p == "anthropic":
        params["max_tokens"] = 16000
    r = llm.complete("t3", model, msgs, params, est_out=600)
    return {"text": r["text"], "calls": [r]}


RUN = {"t1": run_t1, "t2": run_t2, "t3": run_t3}
DATA = {"t1": "t1_fewnerd.jsonl", "t2": "t2_halueval.jsonl", "t3": "t3_hotpot.jsonl"}

TYPE_MAP = {"PERSON": "person", "ORGANIZATION": "organization", "GEO": "location", "EVENT": "event"}
TARGET_TYPES = set(TYPE_MAP.values())


def norm_name_v1(s):
    s = s.upper().replace("\u201c", '"').replace("\u201d", '"').replace("\u2019", "'").replace("\u2018", "'")
    s = re.sub(r"[^\w&.'\- ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" .'-\"")
    s = re.sub(r"\s*'\s*S$", "", s)
    s = re.sub(r"\s+([.'\-])", r"\1", s).strip(" .'-\"")
    if s.startswith("THE "):
        s = s[4:]
    return s


def norm_name(s):
    s = s.upper().replace("\u201c", '"').replace("\u201d", '"').replace("\u2019", "'").replace("\u2018", "'")
    s = re.sub(r"&\s*AMP\s*;?", "&", s)
    s = re.sub(r"\s*'\s*S\b", "", s)
    s = re.sub(r"[^\w&. ]", " ", s)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s+\.", ".", s).strip(" .&")
    if s.startswith("THE "):
        s = s[4:]
    return s


NORM = {"v1": norm_name_v1, "v2": norm_name}


def graphrag_entities(text):
    out = []
    for raw in text.split("##"):
        rec = re.sub(r"^\(|\)$", "", raw.strip())
        if not rec or rec == "<|COMPLETE|>":
            continue
        attrs = rec.split("<|>")
        if attrs[0] == '"entity"' and len(attrs) >= 4:
            name = attrs[1].upper().strip().strip('"')
            typ = attrs[2].upper().strip().strip('"')
            out.append((name, typ))
    return out


def score_t1(item, out, norm="v2"):
    norm_name = NORM[norm]
    gold = {(norm_name(g["text"]), g["type"]) for g in item["gold"] if g["type"] in TARGET_TYPES}
    excluded = {norm_name(g["text"]) for g in item["gold"] if g["type"] not in TARGET_TYPES}
    pred = set()
    for name, typ in graphrag_entities(out["text"]):
        if typ not in TYPE_MAP:
            continue
        n = norm_name(name)
        if not n or (n in excluded and n not in {g[0] for g in gold}):
            continue
        pred.add((n, TYPE_MAP[typ]))
    tp = len(pred & gold)
    ug, up = {g[0] for g in gold}, {p[0] for p in pred}
    utp = len(up & ug)
    return {"tp": tp, "fp": len(pred) - tp, "fn": len(gold) - tp, "utp": utp, "ufp": len(up) - utp, "ufn": len(ug) - utp}


def parse_haystack(text, lenient=False):
    t = text.strip()
    if lenient:
        t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        d = json.loads(t)
    except json.JSONDecodeError:
        return None
    if not isinstance(d, dict) or "statements" not in d or "statement_scores" not in d:
        return None
    if not isinstance(d["statements"], list) or not isinstance(d["statement_scores"], list):
        return None
    if len(d["statements"]) != len(d["statement_scores"]):
        return None
    return d


def t2_pred(text, lenient=False, threshold=0.5):
    d = parse_haystack(text, lenient)
    if d is None:
        return None
    scores = d["statement_scores"]
    if not d["statements"]:
        return int(0 >= threshold)
    try:
        s = sum(float(x) for x in scores) / len(scores)
    except (TypeError, ValueError):
        return None
    return int(s >= threshold)


def score_t2(item, out):
    strict = t2_pred(out["text"])
    lenient = t2_pred(out["text"], lenient=True)
    all_ok = t2_pred(out["text"], threshold=1.0)
    return {"label": item["label"], "pred": strict, "pred_lenient": lenient, "pred_all_statements": all_ok,
            "correct_all_statements": int(all_ok == item["label"]),
            "correct": int(strict == item["label"]), "correct_lenient": int(lenient == item["label"]), "parse_fail": int(strict is None)}


def norm_answer(s):
    s = s.lower()
    s = "".join(ch for ch in s if ch not in set(string.punctuation))
    s = re.sub(r"\b(a|an|the)\b", " ", s)
    return " ".join(s.split())


def f1(pred, gold):
    p, g = norm_answer(pred).split(), norm_answer(gold).split()
    if norm_answer(pred) in ("yes", "no", "noanswer") or norm_answer(gold) in ("yes", "no", "noanswer"):
        if norm_answer(pred) != norm_answer(gold):
            return 0.0
    common = Counter(p) & Counter(g)
    same = sum(common.values())
    if same == 0:
        return 0.0
    pr, rc = same / len(p), same / len(g)
    return 2 * pr * rc / (pr + rc)


def contains(pred, gold):
    p, g = norm_answer(pred).split(), norm_answer(gold).split()
    if not g:
        return 0
    if g in (["yes"], ["no"]):
        return int(bool(p) and p[0] == g[0])
    n = len(g)
    return int(any(p[i:i + n] == g for i in range(len(p) - n + 1)))


def score_t3(item, out):
    return {"correct": contains(out["text"], item["answer"]), "f1": f1(out["text"], item["answer"])}


SCORE = {"t1": score_t1, "t2": score_t2, "t3": score_t3}
