import OpenAI from "openai";

const openai = new OpenAI();

export async function scoreReviews(reviews: string[]) {
  const out = [];
  for (const review of reviews) {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: `classify the sentiment of this review as positive or negative: ${review}` }],
    });
    out.push(res.choices[0].message.content);
  }
  return out;
}

export async function embedAll(docs: { text: string }[]) {
  const vectors = [];
  for (const doc of docs) {
    const e = await openai.embeddings.create({ model: "text-embedding-3-small", input: doc.text });
    vectors.push(e.data[0].embedding);
  }
  return vectors;
}

export async function callWithRetry(prompt: string) {
  while (true) {
    try {
      return await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (e) {
      console.log("retrying", e);
    }
  }
}
