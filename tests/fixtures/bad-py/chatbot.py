import time
from openai import OpenAI

client = OpenAI()


def chat():
    history = [{"role": "system", "content": "you are a helpful assistant"}]
    while True:
        user = input("> ")
        history.append({"role": "user", "content": user})
        res = client.chat.completions.create(model="gpt-4.1", messages=history)
        reply = res.choices[0].message.content
        history.append({"role": "assistant", "content": reply})
        print(reply)


def ask(prompt):
    for attempt in range(5):
        try:
            return client.chat.completions.create(
                model="gpt-4.1-mini",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception:
            pass


def watch_job(url):
    import requests
    while True:
        status = requests.get(url).json()
        if status["done"]:
            return status
        time.sleep(1)
