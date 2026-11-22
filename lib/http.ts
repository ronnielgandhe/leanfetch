export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}

export async function readBody(req: Request, maxBytes: number): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new BodyError(413, "request is too big");
  if (!req.body) throw new BodyError(400, "empty request");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyError(413, "request is too big");
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new BodyError(400, "request body is not valid json");
  }
}

export class BodyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
