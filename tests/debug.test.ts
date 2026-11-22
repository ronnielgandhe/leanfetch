import { test } from "vitest";
import { analyze } from "../lib/analyze";
import { loadDir } from "./load";

test("debug", () => {
  for (const d of ["bad-js", "bad-py", "clean"]) {
    const r = analyze(loadDir(`tests/fixtures/${d}`));
    console.log(d, JSON.stringify(r.stats), r.models);
    for (const f of r.findings) console.log(`  ${f.pattern} ${f.severity}/${f.confidence} ${f.file}:${f.startLine}-${f.endLine} ${f.title} | ${f.evidence.join(" ; ")}`);
  }
});
