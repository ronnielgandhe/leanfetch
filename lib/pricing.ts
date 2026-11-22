import type { Provider } from "./types";

export const PRICING_AS_OF = "2026-11-21";

export const PRICING_SOURCES: { provider: Provider; url: string; note: string }[] = [
  {
    provider: "anthropic",
    url: "https://platform.claude.com/docs/en/about-claude/pricing",
    note: "claude models, standard api rates. batch is 50% of standard. cache reads listed per model where published, otherwise ~0.1x input.",
  },
  {
    provider: "openai",
    url: "https://developers.openai.com/api/docs/pricing",
    note: "standard tier, short context (<272k) rates. batch table lists half of standard for the models checked.",
  },
  {
    provider: "google",
    url: "https://aistudio.google.com/docs/pricing",
    note: "gemini api paid tier, prompts up to 200k tokens. batch api is listed as a 50% cost reduction.",
  },
];

export interface Price {
  id: string;
  provider: Provider;
  input: number;
  output: number;
  cachedInput?: number;
  batchMultiplier?: number;
  kind?: "chat" | "embed";
  tier: "top" | "mid" | "small";
}

const A = (id: string, input: number, output: number, tier: Price["tier"], cachedInput?: number): Price => ({
  id,
  provider: "anthropic",
  input,
  output,
  cachedInput: cachedInput ?? +(input * 0.1).toFixed(4),
  batchMultiplier: 0.5,
  tier,
});
const O = (id: string, input: number, output: number, tier: Price["tier"], cachedInput?: number): Price => ({
  id,
  provider: "openai",
  input,
  output,
  cachedInput,
  batchMultiplier: 0.5,
  tier,
});
const G = (id: string, input: number, output: number, tier: Price["tier"]): Price => ({
  id,
  provider: "google",
  input,
  output,
  batchMultiplier: 0.5,
  tier,
});

export const PRICES: Price[] = [
  A("claude-fable-5-2", 8, 40, "top", 0.2),
  A("claude-fable-5-1", 10, 50, "top", 0.25),
  A("claude-fable-5", 10, 50, "top", 1),
  A("claude-opus-5-5", 4, 20, "top", 0.2),
  A("claude-opus-5", 5, 25, "top"),
  A("claude-opus-4-8", 5, 25, "top"),
  A("claude-opus-4-7", 5, 25, "top"),
  A("claude-opus-4-6", 5, 25, "top"),
  A("claude-sonnet-5-5", 2, 10, "mid", 0.1),
  A("claude-sonnet-5", 2, 10, "mid"),
  A("claude-sonnet-4-6", 3, 15, "mid"),
  A("claude-haiku-5-5", 0.1, 0.5, "small"),
  A("claude-haiku-4-5", 1, 5, "small"),

  O("gpt-6.2-astra", 8, 40, "top", 0.4),
  O("gpt-6.2-sol", 2, 10, "mid", 0.1),
  O("gpt-6-astra", 10, 50, "top", 1),
  O("gpt-6.1-sol", 2, 10, "mid", 0.1),
  O("gpt-6.1-terra", 1, 5, "mid", 0.05),
  O("gpt-6-luna", 0.1, 0.5, "small", 0.01),
  O("gpt-6-sol", 2, 10, "mid", 0.2),
  O("gpt-5.6-sol", 4, 20, "top", 0.4),
  O("gpt-5.6-terra", 2, 12, "mid", 0.2),
  O("gpt-5.6-luna", 0.2, 1.2, "small", 0.02),
  O("gpt-5.5", 5, 30, "top", 0.5),
  O("gpt-5.5-pro", 30, 180, "top"),
  O("gpt-5.4", 2.5, 15, "top", 0.25),
  O("gpt-5.4-pro", 30, 180, "top"),
  O("gpt-5.4-mini", 0.75, 4.5, "small", 0.075),
  O("gpt-5.4-nano", 0.2, 1.25, "small", 0.02),
  O("gpt-5.2", 1.75, 14, "top", 0.175),
  O("gpt-5.2-pro", 21, 168, "top"),
  O("gpt-5.1", 1.25, 10, "top", 0.125),
  O("gpt-5", 1.25, 10, "top", 0.125),
  O("gpt-5-mini", 0.25, 2, "small", 0.025),
  O("gpt-5-nano", 0.05, 0.4, "small", 0.005),
  O("gpt-5-pro", 15, 120, "top"),
  O("gpt-4.1", 2, 8, "top", 0.5),
  O("gpt-4.1-mini", 0.4, 1.6, "small", 0.1),
  O("gpt-4o", 2.5, 10, "top", 1.25),
  O("gpt-4o-mini", 0.15, 0.6, "small", 0.075),
  O("o3-pro", 20, 80, "top"),
  O("o3", 2, 8, "top", 0.5),
  { ...O("text-embedding-3-small", 0.02, 0, "small"), kind: "embed" },
  { ...O("text-embedding-3-large", 0.13, 0, "small"), kind: "embed" },
  { ...O("text-embedding-ada-002", 0.1, 0, "small"), kind: "embed" },

  G("gemini-3.1-pro-preview", 2, 12, "top"),
  G("gemini-3-flash-preview", 0.5, 3, "small"),
  G("gemini-3.1-flash-lite", 0.25, 1.5, "small"),
  G("gemini-2.5-pro", 1.25, 10, "top"),
  G("gemini-2.5-flash", 0.3, 2.5, "small"),
  G("gemini-2.5-flash-lite", 0.1, 0.4, "small"),
];

export const CHEAP_ALTERNATIVE: Partial<Record<Provider, string>> = {
  anthropic: "claude-haiku-5-5",
  openai: "gpt-5-nano",
  google: "gemini-2.5-flash-lite",
};

export function normalizeModel(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(openai|anthropic|google|models|gemini)\//, "")
    .replace(/^(us|eu|apac|global)\.anthropic\./, "")
    .replace(/^anthropic\./, "")
    .replace(/-v\d+(:\d+)?$/, "")
    .replace(/@\d{8}$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-latest$/, "");
}

export function findPrice(model: string | undefined): Price | undefined {
  if (!model) return undefined;
  const id = normalizeModel(model);
  return PRICES.find((p) => p.id === id);
}

export function providerOfModel(model: string): Provider {
  const m = normalizeModel(model);
  if (/^claude|anthropic/.test(m)) return "anthropic";
  if (/^(gpt|o\d|text-embedding|chatgpt|davinci|babbage|whisper|dall-e)/.test(m)) return "openai";
  if (/^(gemini|text-embedding-004|embedding-001|gemma)/.test(m)) return "google";
  if (/^(llama|mistral|mixtral|qwen|deepseek|phi|command)/.test(m)) return "other";
  return "unknown";
}

export function tierOf(model: string): "top" | "mid" | "small" | undefined {
  const priced = findPrice(model);
  if (priced) return priced.tier;
  const m = normalizeModel(model);
  if (/haiku|mini|nano|flash|lite|luna|small|instant|3\.5-turbo/.test(m)) return "small";
  if (/opus|fable|mythos|-pro\b|pro-|astra|^gpt-4(?!o-mini|\.1-mini|\.1-nano)|^o1(?!-mini)|^o3(?!-mini)|^gpt-5(\.\d)?$/.test(m)) return "top";
  if (/sonnet|gemini-[\d.]+-pro/.test(m)) return "mid";
  return undefined;
}
