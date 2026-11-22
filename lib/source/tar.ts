export interface TarEntry {
  path: string;
  size: number;
  data: Uint8Array;
}

const decoder = new TextDecoder();

function str(buf: Uint8Array, start: number, len: number): string {
  let end = start;
  while (end < start + len && buf[end] !== 0) end++;
  return decoder.decode(buf.subarray(start, end));
}

function octal(buf: Uint8Array, start: number, len: number): number {
  const s = str(buf, start, len).trim();
  return s ? parseInt(s, 8) : 0;
}

export function untar(buf: Uint8Array, want: (path: string, size: number) => boolean): TarEntry[] {
  const out: TarEntry[] = [];
  let off = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = str(header, 345, 155);
    let name = str(header, 0, 100);
    if (prefix) name = `${prefix}/${name}`;
    const dataStart = off + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) break;
    if (type === "L") {
      longName = str(buf, dataStart, size);
    } else if (type === "x") {
      const pax = decoder.decode(buf.subarray(dataStart, dataEnd));
      const m = /\d+ path=([^\n]*)\n/.exec(pax);
      if (m) paxPath = m[1];
    } else if (type !== "g") {
      const path = paxPath ?? longName ?? name;
      longName = null;
      paxPath = null;
      if ((type === "0" || type === "\0") && want(path, size)) out.push({ path, size, data: buf.slice(dataStart, dataEnd) });
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}
