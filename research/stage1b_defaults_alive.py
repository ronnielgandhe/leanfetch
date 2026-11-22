import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import llm

ROOT = Path(__file__).resolve().parent
CHECKS = [
    ("graphrag", "packages/graphrag/graphrag/config/defaults.py:33", "gpt-4.1"),
    ("haystack", "haystack/components/generators/chat/openai.py:135", "gpt-5.6-terra"),
    ("llama_index", "llama-index-llms-openai/llama_index/llms/openai/responses.py:105", "gpt-4o-mini"),
    ("llama_index", "llama-index-llms-openai/llama_index/llms/openai/base.py:99", "gpt-3.5-turbo"),
    ("llama_index", "llama-index-core/llama_index/core/postprocessor/rankGPT_rerank.py:20", "gpt-3.5-turbo-16k"),
]
out = []
for repo, where, model in CHECKS:
    row = {"repo": repo, "line": where, "model": model, "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    try:
        from openai import OpenAI
        r = OpenAI(max_retries=0).chat.completions.create(model=model, messages=[{"role": "user", "content": "Reply with the single word OK."}])
        row.update(status="ok", served_model=r.model, reply=r.choices[0].message.content)
        p = llm.PRICES["models"].get(model)
        if p:
            llm._record("defaults_alive", model, llm.cost(model, r.usage.prompt_tokens, r.usage.completion_tokens))
    except Exception as e:
        row.update(status="error", error_type=type(e).__name__, error=str(e)[:300])
    out.append(row)
    print(row)
(ROOT / "results" / "defaults_alive.json").write_text(json.dumps(out, indent=1))
