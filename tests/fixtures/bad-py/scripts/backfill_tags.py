import json
import sqlite3

import anthropic
from tenacity import retry, wait_exponential

client = anthropic.Anthropic()


@retry(wait=wait_exponential(min=1, max=30))
def tag(text):
    return client.messages.create(
        model="claude-opus-5-5",
        max_tokens=10,
        messages=[{"role": "user", "content": f"return only the category label for: {text}"}],
    )


def main():
    db = sqlite3.connect("app.db")
    rows = db.execute("select * from products").fetchall()
    for row in rows:
        print(tag(row[1]))
    report = client.messages.create(
        model="claude-sonnet-5-5",
        max_tokens=2000,
        messages=[{"role": "user", "content": f"summarize this catalog: {json.dumps(rows)}"}],
    )
    print(report)


if __name__ == "__main__":
    main()
