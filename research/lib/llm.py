import hashlib
import json
import os
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
SPEND = ROOT / "spend.json"
PRICES = json.loads((ROOT / "prices.json").read_text())
CAP_USD = 25.0
_lock = threading.Lock()
_clients = {}


class BudgetExceeded(RuntimeError):
    pass


def provider(model):
    if model.startswith("claude-"):
        return "anthropic"
    if model.startswith("gemini-"):
        return "google"
    return "openai"


def price(model):
    p = PRICES["models"].get(model)
    if not p:
        raise KeyError(f"no verified price for {model}")
    return p


def cost(model, tin, tout):
    p = price(model)
    return (tin * p["input"] + tout * p["output"]) / 1e6


def ledger():
    if SPEND.exists():
        return json.loads(SPEND.read_text())
    return {"cap_usd": CAP_USD, "total_usd": 0.0, "by_stage": {}, "by_model": {}, "calls": 0}


def _record(stage, model, usd):
    with _lock:
        led = ledger()
        led["total_usd"] = round(led["total_usd"] + usd, 6)
        led["by_stage"][stage] = round(led["by_stage"].get(stage, 0) + usd, 6)
        led["by_model"][model] = round(led["by_model"].get(model, 0) + usd, 6)
        led["calls"] += 1
        led["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        SPEND.write_text(json.dumps(led, indent=2))


def spent():
    return ledger()["total_usd"]


def guard(estimate_usd):
    if spent() + estimate_usd > CAP_USD:
        raise BudgetExceeded(f"spent {spent():.4f} + estimate {estimate_usd:.4f} > cap {CAP_USD}")


def _client(name):
    if name == "google":
        from google import genai
        from google.genai import types
        key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GOOGLE_CLOUD_API_KEY")
        return genai.Client(api_key=key, http_options=types.HttpOptions(api_version="v1beta"))
    if name in _clients:
        return _clients[name]
    if name == "openai":
        from openai import OpenAI
        c = OpenAI(max_retries=4, timeout=180)
    elif name == "anthropic":
        import anthropic
        c = anthropic.Anthropic(max_retries=4, timeout=300)
    else:
        raise ValueError(name)
    _clients[name] = c
    return c


def _key(model, messages, params):
    blob = json.dumps({"m": model, "msg": messages, "p": params}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()


def _openai(model, messages, params):
    r = _client("openai").chat.completions.create(model=model, messages=messages, **params)
    u = r.usage
    det = getattr(u, "completion_tokens_details", None)
    return {
        "text": r.choices[0].message.content or "",
        "finish": r.choices[0].finish_reason,
        "input_tokens": u.prompt_tokens,
        "output_tokens": u.completion_tokens,
        "reasoning_tokens": getattr(det, "reasoning_tokens", 0) if det else 0,
        "served_model": r.model,
    }


def _anthropic(model, messages, params):
    system = "\n".join(m["content"] for m in messages if m["role"] == "system")
    msgs = [m for m in messages if m["role"] != "system"]
    kw = dict(params)
    kw.setdefault("max_tokens", 16000)
    if system:
        kw["system"] = system
    r = _client("anthropic").messages.create(model=model, messages=msgs, **kw)
    text = "".join(b.text for b in r.content if b.type == "text")
    return {
        "text": text,
        "finish": r.stop_reason,
        "input_tokens": r.usage.input_tokens,
        "output_tokens": r.usage.output_tokens,
        "reasoning_tokens": None,
        "served_model": r.model,
    }


def _google(model, messages, params):
    from google.genai import types
    system = "\n".join(m["content"] for m in messages if m["role"] == "system") or None
    contents = [
        types.Content(role="user" if m["role"] == "user" else "model", parts=[types.Part(text=m["content"])])
        for m in messages if m["role"] != "system"
    ]
    cfg = types.GenerateContentConfig(system_instruction=system, **params)
    c = _client("google")
    r = c.models.generate_content(model=model, contents=contents, config=cfg)
    u = r.usage_metadata
    thoughts = u.thoughts_token_count or 0
    return {
        "text": r.text or "",
        "finish": str(r.candidates[0].finish_reason) if r.candidates else None,
        "input_tokens": u.prompt_token_count or 0,
        "output_tokens": (u.candidates_token_count or 0) + thoughts,
        "reasoning_tokens": thoughts,
        "served_model": getattr(r, "model_version", model),
    }


CALL = {"openai": _openai, "anthropic": _anthropic, "google": _google}


def complete(stage, model, messages, params=None, est_out=2000):
    params = params or {}
    k = _key(model, messages, params)
    path = CACHE / stage / model / f"{k}.json"
    if path.exists():
        return json.loads(path.read_text())
    est_in = sum(len(m["content"]) for m in messages) / 3.5
    guard(cost(model, est_in, est_out))
    t0 = time.time()
    out = CALL[provider(model)](model, messages, params)
    out["latency_s"] = round(time.time() - t0, 3)
    out["cost_usd"] = cost(model, out["input_tokens"], out["output_tokens"])
    out["request"] = {"model": model, "messages": messages, "params": params}
    out["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1))
    _record(stage, model, out["cost_usd"])
    return out
