import { DEEP_READ, DeepReadError, deepReadEnabled, runDeepRead, sanitizeCandidates } from "@/lib/deepread";
import { BodyError, json, readBody } from "@/lib/http";
import { clientIp, envInt, getLimiter, resetMessage } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAY = 86400;

function limits() {
  return { perIp: envInt("DEEP_READ_LIMIT_PER_IP_PER_DAY", 3), global: envInt("DEEP_READ_LIMIT_PER_DAY", 150) };
}

export async function GET() {
  return json({ enabled: deepReadEnabled(), model: deepReadEnabled() ? DEEP_READ.model : null, maxFindings: DEEP_READ.maxFindings, perIpPerDay: limits().perIp });
}

export async function POST(req: Request) {
  if (!deepReadEnabled()) return json({ error: "deep read is off on this deploy. the static report is complete without it.", code: "disabled" }, 503);
  let body: { findings?: unknown };
  try {
    body = (await readBody(req, 64 * 1024)) as { findings?: unknown };
  } catch (e) {
    return json({ error: e instanceof BodyError ? e.message : "bad request", code: "bad_request" }, e instanceof BodyError ? e.status : 400);
  }
  const cands = sanitizeCandidates(body?.findings);
  if (!cands.length) return json({ error: "no valid findings to review", code: "bad_request" }, 400);

  const ip = clientIp(req.headers);
  const { perIp, global } = limits();
  const limiter = getLimiter();
  try {
    const g = await limiter.peek("deep:global", global);
    if (!g.ok) return json({ error: "deep read hit its daily cap for everyone. the static report still works. try again tomorrow.", code: "rate_limited" }, 429);
    const mine = await limiter.hit(`deep:${ip}`, perIp, DAY);
    if (!mine.ok) return json({ error: `you have used your ${perIp} deep reads for today. try again in ${resetMessage(mine.resetSec)}.`, code: "rate_limited" }, 429, { "retry-after": String(mine.resetSec) });
    const all = await limiter.hit("deep:global", global, DAY);
    if (!all.ok) return json({ error: "deep read hit its daily cap for everyone. the static report still works. try again tomorrow.", code: "rate_limited" }, 429);
  } catch {
    return json({ error: "rate limiter is unavailable, so deep read is paused", code: "limiter_down" }, 503);
  }

  try {
    const result = await runDeepRead(cands);
    return json(result);
  } catch (e) {
    if (e instanceof DeepReadError) return json({ error: e.message, code: "deep_read_failed" }, e.status);
    console.error("deep read failed", e instanceof Error ? e.name : "unknown");
    return json({ error: "deep read failed on our side", code: "internal" }, 500);
  }
}
