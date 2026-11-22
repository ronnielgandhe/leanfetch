import { describe, expect, test } from "vitest";
import { analyze } from "../lib/analyze";
import { defaultAssumptions } from "../lib/savings";
import type { ScanReport } from "../lib/types";
import { estimateFlag, toOldReport } from "../lib/ui/adapter";
import { loadDir } from "./load";

function report(dir: string): ScanReport {
  const r = analyze(loadDir(`tests/fixtures/${dir}`));
  return {
    source: { kind: "upload", name: dir },
    stats: { ...r.stats, filesInSource: r.stats.filesScanned, filesSkipped: 0, capped: false },
    findings: r.findings,
    models: r.models,
    providers: r.providers,
    errors: r.errors,
    notes: [],
    durationMs: 1,
  };
}

describe("ui mapping layer", () => {
  test("maps findings into the original flag shape", () => {
    const old = toOldReport(report("bad-js"));
    expect(old.flags.length).toBeGreaterThan(5);
    expect(old.summary.totalFlags).toBe(old.flags.length);
    expect(old.summary.critical + old.summary.warning + old.summary.info).toBe(old.flags.length);
    for (const f of old.flags) {
      expect(["critical", "warning", "info"]).toContain(f.severity);
      expect(f.title).not.toContain("`");
      expect(typeof f.codeSnippet).toBe("string");
    }
  });

  test("per-flag estimate follows the shared savings engine", () => {
    const r = report("bad-js");
    const old = toOldReport(r);
    const a = defaultAssumptions(r);
    const n1 = old.flags.find((f) => f.pattern === "n-plus-one" && f.confidence === "high")!;
    const e = estimateFlag(n1, a);
    expect(e.priced).toBe(true);
    expect(e.afterCost).toBeLessThan(e.beforeCost);
    const http = old.flags.find((f) => f.finding.callKind === "http")!;
    expect(estimateFlag(http, a).priced).toBe(false);
  });

  test("no llm usage reads as an honest empty result", () => {
    const empty = toOldReport({ ...report("clean"), findings: [], stats: { ...report("clean").stats, llmCallSites: 0 } });
    expect(empty.overallAssessment).toMatch(/No LLM API calls were found/);
  });

  test("tolerates unknown extra fields on findings", () => {
    const r = report("bad-py");
    const withExtra = { ...r, findings: r.findings.map((f) => ({ ...f, patch: "diff", tokens: { in: 1 } })) };
    expect(() => toOldReport(withExtra as ScanReport)).not.toThrow();
  });
});
