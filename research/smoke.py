import sys
sys.path.insert(0, "lib")
import llm
for m in llm.PRICES["models"]:
    try:
        r = llm.complete("smoke", m, [{"role": "user", "content": "Reply with the single word OK."}], {}, est_out=500)
        print(m, "->", repr(r["text"][:20]), r["served_model"], r["input_tokens"], r["output_tokens"], round(r["cost_usd"], 6))
    except Exception as e:
        print(m, "ERROR", type(e).__name__, str(e)[:160])
