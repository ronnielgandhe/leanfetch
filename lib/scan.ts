import { analyze } from "./analyze";
import { isCandidate, LIMITS } from "./source/filter";
import { collect, downloadRepo, parseRepo, resolveRef, ScanError, type Collected } from "./source/github";
import type { ScanEvent, ScanReport, ScanSource } from "./types";

export type ScanInput = { kind: "github"; repo: string } | { kind: "upload"; name: string; files: { path: string; content: string }[] };

export function validateUpload(body: unknown): ScanInput {
  const b = body as { name?: unknown; files?: unknown };
  if (!Array.isArray(b.files)) throw new ScanError("bad_upload", "no files in the upload");
  if (b.files.length === 0) throw new ScanError("bad_upload", "no files in the upload");
  if (b.files.length > LIMITS.uploadFiles * 3) throw new ScanError("too_big", `too many files (max ${LIMITS.uploadFiles} source files)`, 413);
  let bytes = 0;
  const files: { path: string; content: string }[] = [];
  for (const f of b.files as { path?: unknown; content?: unknown }[]) {
    if (typeof f?.path !== "string" || typeof f?.content !== "string") throw new ScanError("bad_upload", "each file needs a path and text content");
    const path = f.path.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter((s) => s && s !== "." && s !== "..").join("/").slice(0, 300);
    bytes += f.content.length;
    if (bytes > LIMITS.uploadBytes) throw new ScanError("too_big", `upload is over ${LIMITS.uploadBytes / 1024 / 1024}mb of text`, 413);
    files.push({ path, content: f.content });
  }
  const name = typeof b.name === "string" ? b.name.slice(0, 120) : "upload";
  return { kind: "upload", name, files };
}

export async function runScan(input: ScanInput, emit: (e: ScanEvent) => void): Promise<ScanReport> {
  const t0 = Date.now();
  const notes: string[] = [];
  let source: ScanSource;
  let collected: Collected;
  if (input.kind === "github") {
    const r = parseRepo(input.repo);
    emit({ type: "progress", step: "resolving", detail: `${r.owner}/${r.repo}` });
    const { ref, note } = await resolveRef(r);
    if (note) notes.push(note);
    emit({ type: "progress", step: "downloading", detail: `${r.owner}/${r.repo}@${ref}` });
    collected = await downloadRepo(r, ref);
    source = { kind: "github", owner: r.owner, repo: r.repo, ref };
  } else {
    const entries = input.files.filter((f) => isCandidate(f.path)).map((f) => ({ path: f.path, size: f.content.length, content: f.content }));
    collected = collect(entries, input.files.length);
    source = { kind: "upload", name: input.name };
  }
  if (collected.capped) notes.push(`scanned the ${LIMITS.maxFiles} most relevant source files; the rest were skipped`);
  if (!collected.files.length) {
    throw new ScanError("no_source", "no javascript, typescript or python source files found to scan", 422);
  }
  emit({ type: "progress", step: "analyzing", detail: `${collected.files.length} source files` });
  const result = analyze(collected.files);
  emit({ type: "progress", step: "estimating", detail: `${result.findings.length} findings` });
  if (result.stats.llmCallSites === 0) {
    notes.push(result.stats.httpCallSites ? "no llm api calls found. checked generic http calls only." : "no llm or http api calls found in the scanned files.");
  }
  return {
    source,
    stats: { ...result.stats, filesInSource: collected.filesInSource, filesSkipped: collected.filesSkipped, capped: collected.capped },
    findings: result.findings,
    models: result.models,
    providers: result.providers,
    errors: result.errors,
    notes,
    durationMs: Date.now() - t0,
  };
}
