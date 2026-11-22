import anthropic

client = anthropic.Anthropic(max_retries=4)

SYSTEM = "you label support tickets."


def label_batch(tickets):
    return client.messages.batches.create(
        requests=[
            {
                "custom_id": str(i),
                "params": {
                    "model": "claude-haiku-5-5",
                    "max_tokens": 20,
                    "system": SYSTEM,
                    "messages": [{"role": "user", "content": t}],
                },
            }
            for i, t in enumerate(tickets)
        ]
    )


def chat(history, text):
    history.append({"role": "user", "content": text})
    recent = history[-12:]
    return client.messages.create(model="claude-sonnet-5-5", max_tokens=800, system=SYSTEM, messages=recent)
