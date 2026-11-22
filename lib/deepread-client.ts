import type { Finding, PatternId } from "./types";

export interface Candidate {
  id: string;
  pattern: PatternId;
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  evidence: string[];
  code: string;
}

export function candidateFromFinding(f: Finding): Candidate {
  return {
    id: f.id,
    pattern: f.pattern,
    file: f.file,
    startLine: f.startLine,
    endLine: f.endLine,
    title: f.title,
    evidence: f.evidence,
    code: f.snippet.map((l) => (l.n < 0 ? "..." : `${l.n}: ${l.text}`)).join("\n"),
  };
}
