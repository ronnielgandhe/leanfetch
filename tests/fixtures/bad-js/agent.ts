import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import { SYSTEM_PROMPT } from "./prompts";

const client = new Anthropic();

export async function summarize(text: string) {
  const res = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: text }],
  });
  return res.content;
}

export async function summarizeTickets(tickets: string[]) {
  return Promise.all(tickets.map((t) => summarize(t)));
}

export async function answerFromDocs(question: string) {
  const manual = fs.readFileSync("./docs/manual.md", "utf8");
  return summarize(`answer using this manual:\n${manual}\n\nquestion: ${question}`);
}

export async function dailyTagline() {
  const res = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 60,
    messages: [{ role: "user", content: "write a one line tagline for a coffee shop" }],
  });
  return res.content;
}
