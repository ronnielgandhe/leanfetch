export interface Limiter {
  hit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; count: number; resetSec: number }>;
  peek(key: string, limit: number): Promise<{ ok: boolean; count: number }>;
}

class MemoryLimiter implements Limiter {
  private store = new Map<string, { count: number; reset: number }>();

  async hit(key: string, limit: number, windowSec: number) {
    const now = Date.now();
    const cur = this.store.get(key);
    const entry = cur && cur.reset > now ? cur : { count: 0, reset: now + windowSec * 1000 };
    entry.count++;
    this.store.set(key, entry);
    if (this.store.size > 10000) for (const [k, v] of this.store) if (v.reset <= now) this.store.delete(k);
    return { ok: entry.count <= limit, count: entry.count, resetSec: Math.ceil((entry.reset - now) / 1000) };
  }

  async peek(key: string, limit: number) {
    const cur = this.store.get(key);
    const count = cur && cur.reset > Date.now() ? cur.count : 0;
    return { ok: count < limit, count };
  }
}

class UpstashLimiter implements Limiter {
  constructor(
    private url: string,
    private token: string,
  ) {}

  private async pipeline(cmds: (string | number)[][]): Promise<{ result: unknown }[]> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`limiter store returned ${res.status}`);
    return res.json();
  }

  async hit(key: string, limit: number, windowSec: number) {
    const k = `lf:${key}`;
    const [inc, , ttl] = await this.pipeline([["INCR", k], ["EXPIRE", k, windowSec, "NX"], ["TTL", k]]);
    const count = Number(inc.result);
    return { ok: count <= limit, count, resetSec: Math.max(1, Number(ttl.result)) };
  }

  async peek(key: string, limit: number) {
    const [get] = await this.pipeline([["GET", `lf:${key}`]]);
    const count = Number(get.result ?? 0);
    return { ok: count < limit, count };
  }
}

let limiter: Limiter | undefined;

export function getLimiter(): Limiter {
  if (!limiter) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    limiter = url && token ? new UpstashLimiter(url, token) : new MemoryLimiter();
  }
  return limiter;
}

export function limiterKind(): "upstash" | "memory" {
  return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? "upstash" : "memory";
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : headers.get("x-real-ip")) ?? "unknown";
  return ip.trim().slice(0, 64) || "unknown";
}

export function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

export function resetMessage(sec: number): string {
  if (sec < 90) return `${sec} seconds`;
  if (sec < 5400) return `${Math.ceil(sec / 60)} minutes`;
  return `${Math.ceil(sec / 3600)} hours`;
}
