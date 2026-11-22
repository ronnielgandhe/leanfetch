export type Lang = "js" | "py";
export type Level = "high" | "medium" | "low";
export type Provider = "anthropic" | "openai" | "google" | "other" | "local" | "unknown";
export type CallKind = "chat" | "embed" | "http";

export type PatternId =
  | "n-plus-one"
  | "missing-max-tokens"
  | "retry-storm"
  | "expensive-model"
  | "no-prompt-caching"
  | "history-resend"
  | "oversized-context"
  | "unbatched-embeddings"
  | "no-response-cache"
  | "batch-api-candidate"
  | "polling-no-backoff"
  | "duplicate-fetch";

export interface SourceFile {
  path: string;
  content: string;
}

export interface SnippetLine {
  n: number;
  text: string;
  hot: boolean;
}

export interface Finding {
  id: string;
  pattern: PatternId;
  severity: Level;
  confidence: Level;
  file: string;
  startLine: number;
  endLine: number;
  snippet: SnippetLine[];
  title: string;
  evidence: string[];
  callKind: CallKind;
  provider: Provider;
  model?: string;
  suggestedModel?: string;
  promptTokens?: number;
  siteKey: string;
}

export interface ScanStats {
  filesInSource: number;
  filesScanned: number;
  filesSkipped: number;
  llmCallSites: number;
  httpCallSites: number;
  wrappers: number;
  bytesScanned: number;
  capped: boolean;
}

export type ScanSource =
  | { kind: "github"; owner: string; repo: string; ref: string }
  | { kind: "upload"; name: string };

export interface ScanReport {
  source: ScanSource;
  stats: ScanStats;
  findings: Finding[];
  models: string[];
  providers: Provider[];
  errors: string[];
  notes: string[];
  durationMs: number;
}

export type ScanEvent =
  | { type: "progress"; step: string; detail?: string }
  | { type: "report"; report: ScanReport }
  | { type: "error"; message: string; code?: string };
