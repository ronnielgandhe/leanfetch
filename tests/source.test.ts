import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { isCandidate, isTest } from "../lib/source/filter";
import { collect, parseRepo } from "../lib/source/github";
import { untar } from "../lib/source/tar";
import { validateUpload } from "../lib/scan";

function tarOf(files: Record<string, string>): Uint8Array {
  const blocks: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const [name, body] of Object.entries(files)) {
    const h = new Uint8Array(512);
    h.set(enc.encode(name), 0);
    h.set(enc.encode("0000644\0"), 100);
    h.set(enc.encode(body.length.toString(8).padStart(11, "0") + "\0"), 124);
    h[156] = 48;
    h.set(enc.encode("ustar\0"), 257);
    blocks.push(h);
    const data = enc.encode(body);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

describe("repo url parsing", () => {
  test("accepts common forms", () => {
    expect(parseRepo("https://github.com/vercel/next.js")).toEqual({ owner: "vercel", repo: "next.js", ref: undefined });
    expect(parseRepo("github.com/a-b/c_d.git")).toEqual({ owner: "a-b", repo: "c_d", ref: undefined });
    expect(parseRepo("owner/repo")).toEqual({ owner: "owner", repo: "repo", ref: undefined });
    expect(parseRepo("https://github.com/o/r/tree/dev")).toEqual({ owner: "o", repo: "r", ref: "dev" });
  });

  test("rejects anything that is not github.com", () => {
    for (const bad of ["https://evil.com/o/r", "http://169.254.169.254/latest", "gitlab.com/o/r", "github.com/o", "github.com/../../etc", "file:///etc/passwd", "github.com/o/r/tree/..%2f", "o/r/issues"]) {
      expect(() => parseRepo(bad), bad).toThrow();
    }
  });
});

describe("tar + filters", () => {
  test("untars and strips the top folder", () => {
    const tar = tarOf({ "repo-abc/src/a.ts": "export const a = 1;", "repo-abc/node_modules/x/index.js": "x", "repo-abc/README.md": "# hi" });
    const entries = untar(new Uint8Array(gunzipSync(gzipSync(tar))), (p) => isCandidate(p.replace(/^[^/]+\//, "")));
    expect(entries.map((e) => e.path)).toEqual(["repo-abc/src/a.ts"]);
  });

  test("skips vendor, lock, minified and test files", () => {
    expect(isCandidate("dist/app.js")).toBe(false);
    expect(isCandidate("src/app.min.js")).toBe(false);
    expect(isCandidate("types/x.d.ts")).toBe(false);
    expect(isCandidate("src/app.py")).toBe(true);
    expect(isTest("src/__tests__/a.ts")).toBe(true);
    expect(isTest("tests/test_api.py")).toBe(true);
    const c = collect([{ path: "a.js", size: 10, content: "x".repeat(5000) + "\n" + "y".repeat(5000) }, { path: "b.js", size: 10, content: "const b = 1;" }], 2);
    expect(c.files.map((f) => f.path)).toEqual(["b.js"]);
  });

  test("upload validation strips path traversal and caps size", () => {
    const v = validateUpload({ files: [{ path: "../../etc/x.py", content: "print(1)" }] });
    expect(v.kind === "upload" && v.files[0].path).toBe("etc/x.py");
    expect(() => validateUpload({ files: [{ path: "a.py", content: "x".repeat(4 * 1024 * 1024) }] })).toThrow();
    expect(() => validateUpload({ files: "nope" })).toThrow();
  });
});
