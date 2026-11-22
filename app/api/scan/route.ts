import { BodyError, json, readBody } from "@/lib/http";
import { clientIp, envInt, getLimiter, resetMessage } from "@/lib/ratelimit";
import { runScan, validateUpload, type ScanInput } from "@/lib/scan";
import { ScanError } from "@/lib/source/github";
import type { ScanEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const limit = envInt("SCAN_LIMIT_PER_10_MIN", 10);
  try {
    const hit = await getLimiter().hit(`scan:${ip}`, limit, 600);
    if (!hit.ok) {
      return json({ error: `slow down: ${limit} scans per 10 minutes. try again in ${resetMessage(hit.resetSec)}.`, code: "rate_limited" }, 429, { "retry-after": String(hit.resetSec) });
    }
  } catch {
    return json({ error: "rate limiter is unavailable, try again shortly", code: "limiter_down" }, 503);
  }

  let input: ScanInput;
  try {
    const body = (await readBody(req, MAX_BODY)) as { kind?: unknown; repo?: unknown };
    if (body?.kind === "github" && typeof body.repo === "string") input = { kind: "github", repo: body.repo };
    else if (body?.kind === "upload") input = validateUpload(body);
    else return json({ error: "send { kind: 'github', repo } or { kind: 'upload', files }", code: "bad_request" }, 400);
  } catch (e) {
    if (e instanceof BodyError) return json({ error: e.message, code: "bad_request" }, e.status);
    if (e instanceof ScanError) return json({ error: e.message, code: e.code }, e.status);
    return json({ error: "could not read the request", code: "bad_request" }, 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ScanEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        const report = await runScan(input, emit);
        emit({ type: "report", report });
      } catch (e) {
        if (e instanceof ScanError) emit({ type: "error", message: e.message, code: e.code });
        else {
          console.error("scan failed", e instanceof Error ? e.message : "unknown");
          emit({ type: "error", message: "the scan failed on our side. nothing was analyzed, so there is no report.", code: "internal" });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
