import { unzipSync } from "fflate";
import { isCandidate, LIMITS } from "../source/filter";

export interface PickedFiles {
  name: string;
  files: { path: string; content: string }[];
  bytes: number;
  skipped: number;
}

const decoder = new TextDecoder();

export async function readPicked(list: File[]): Promise<PickedFiles> {
  const files: { path: string; content: string }[] = [];
  let bytes = 0;
  let skipped = 0;
  const push = (path: string, content: string) => {
    if (!isCandidate(path)) {
      skipped++;
      return;
    }
    if (bytes + content.length > LIMITS.uploadBytes || files.length >= LIMITS.uploadFiles) {
      throw new Error(`upload is capped at ${LIMITS.uploadBytes / 1024 / 1024}mb of source and ${LIMITS.uploadFiles} files. drop a smaller folder.`);
    }
    bytes += content.length;
    files.push({ path, content });
  };
  for (const f of list) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (/\.zip$/i.test(f.name)) {
      if (f.size > 25 * 1024 * 1024) throw new Error("zip is over 25mb");
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), {
        filter: (e) => !e.name.endsWith("/") && isCandidate(e.name) && e.originalSize <= LIMITS.maxFileBytes,
      });
      for (const [path, data] of Object.entries(entries)) push(path, decoder.decode(data));
      continue;
    }
    if (f.size > LIMITS.maxFileBytes) {
      skipped++;
      continue;
    }
    push(rel, await f.text());
  }
  const name = list.length === 1 ? list[0].name : `${list.length} files`;
  return { name, files, bytes, skipped };
}
