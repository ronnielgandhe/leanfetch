import { gunzipSync } from "node:zlib";
import type { SourceFile } from "../types";
import { isCandidate, isTest, LIMITS, looksMinified, priority } from "./filter";
import { untar } from "./tar";

export class ScanError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9._\/-]{1,120}$/;

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
}

export function parseRepo(input: string): RepoRef {
  let s = input.trim();
  if (s.length > 300) throw new ScanError("bad_repo", "that does not look like a github repo url");
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (/^github\.com\//i.test(s)) s = s.slice("github.com/".length);
  else if (s.includes("://") || /^[^/]+\.[a-z]{2,}\//i.test(s)) throw new ScanError("bad_repo", "only public github.com repos are supported");
  s = s.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const parts = s.split("/");
  const [owner, rawRepo, kind, ...rest] = parts;
  const repo = (rawRepo ?? "").replace(/\.git$/, "");
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") {
    throw new ScanError("bad_repo", "use a github url like github.com/owner/repo");
  }
  let ref: string | undefined;
  if (kind === "tree" || kind === "blob") {
    ref = rest[0];
    if (!ref || !REF.test(ref) || ref.includes("..")) throw new ScanError("bad_repo", "that branch name does not look right");
  } else if (kind) {
    throw new ScanError("bad_repo", "use a github url like github.com/owner/repo");
  }
  return { owner, repo, ref };
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "leanfetch", "x-github-api-version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export async function resolveRef(r: RepoRef): Promise<{ ref: string; note?: string }> {
  if (r.ref) return { ref: r.ref };
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}`, { headers: ghHeaders(), signal: AbortSignal.timeout(10000), cache: "no-store" });
  } catch {
    return { ref: "HEAD", note: "github api did not answer, scanned the default branch via HEAD" };
  }
  if (res.status === 404) throw new ScanError("not_found", "repo not found. it has to be public on github.com", 404);
  if (res.status === 403 || res.status === 429) return { ref: "HEAD", note: "github api rate limit hit, scanned the default branch via HEAD" };
  if (!res.ok) return { ref: "HEAD", note: `github api returned ${res.status}, scanned the default branch via HEAD` };
  const data = (await res.json()) as { default_branch?: string; private?: boolean; size?: number };
  if (data.private) throw new ScanError("not_found", "repo not found. it has to be public on github.com", 404);
  if (typeof data.size === "number" && data.size > 400_000) throw new ScanError("too_big", "repo is too big to scan here (over ~400mb). try uploading the folder that matters", 413);
  return { ref: data.default_branch && REF.test(data.default_branch) ? data.default_branch : "HEAD" };
}

async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > cap) throw new ScanError("too_big", `repo archive is over ${Math.round(cap / 1024 / 1024)}mb, too big to scan here`, 413);
  if (!res.body) throw new ScanError("fetch_failed", "github sent an empty archive", 502);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new ScanError("too_big", `repo archive is over ${Math.round(cap / 1024 / 1024)}mb, too big to scan here`, 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export interface Collected {
  files: SourceFile[];
  filesInSource: number;
  filesSkipped: number;
  capped: boolean;
}

export async function downloadRepo(r: RepoRef, ref: string): Promise<Collected> {
  const url = `https://codeload.github.com/${r.owner}/${r.repo}/tar.gz/${ref.split("/").map(encodeURIComponent).join("/")}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": "leanfetch" }, signal: AbortSignal.timeout(25000), cache: "no-store" });
  } catch {
    throw new ScanError("fetch_failed", "could not download the repo from github (timed out or network error)", 502);
  }
  if (res.status === 404) throw new ScanError("not_found", ref === "HEAD" ? "repo not found. it has to be public on github.com" : `branch "${ref}" not found`, 404);
  if (!res.ok) throw new ScanError("fetch_failed", `github returned ${res.status} for the archive`, 502);
  const gz = await readCapped(res, LIMITS.tarballBytes);
  let tar: Buffer;
  try {
    tar = gunzipSync(gz, { maxOutputLength: LIMITS.unpackedBytes });
  } catch (e) {
    if (e instanceof RangeError || (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new ScanError("too_big", "repo is too big once unpacked", 413);
    throw new ScanError("fetch_failed", "could not unpack the repo archive", 502);
  }
  let total = 0;
  const entries = untar(new Uint8Array(tar.buffer, tar.byteOffset, tar.byteLength), (path) => {
    total++;
    return isCandidate(path.replace(/^[^/]+\//, ""));
  });
  return collect(entries.map((e) => ({ path: e.path.replace(/^[^/]+\//, ""), size: e.size, data: e.data })), total);
}

const decoder = new TextDecoder("utf-8", { fatal: false });

export function collect(entries: { path: string; size: number; data?: Uint8Array; content?: string }[], totalInSource: number): Collected {
  let skipped = totalInSource - entries.length;
  const kept: (SourceFile & { score: number })[] = [];
  for (const e of entries) {
    if (e.size > LIMITS.maxFileBytes || isTest(e.path)) {
      skipped++;
      continue;
    }
    const content = e.content ?? decoder.decode(e.data);
    if (content.includes("\u0000") || looksMinified(content)) {
      skipped++;
      continue;
    }
    kept.push({ path: e.path, content, score: priority(e.path, content) });
  }
  kept.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const capped = kept.length > LIMITS.maxFiles;
  const files = kept.slice(0, LIMITS.maxFiles).map(({ path, content }) => ({ path, content }));
  return { files, filesInSource: totalInSource, filesSkipped: skipped + Math.max(0, kept.length - LIMITS.maxFiles), capped };
}
