"use client";

import { useEffect, useMemo, useState } from "react";
import { candidateFromFinding } from "@/lib/deepread-client";
import { sourceLabel, toMarkdown } from "@/lib/markdown";
import { PATTERN_ORDER, PATTERNS } from "@/lib/patterns";
import { PRICES, PRICING_AS_OF, PRICING_SOURCES, findPrice } from "@/lib/pricing";
import { defaultAssumptions, estimate, money, totals, type Assumptions } from "@/lib/savings";
import type { Finding, PatternId, ScanReport } from "@/lib/types";
import { FindingCard, type Verdict } from "./finding";

interface DeepState {
  status: "unknown" | "off" | "ready" | "running" | "done" | "error";
  model?: string | null;
  maxFindings?: number;
  summary?: string;
  error?: string;
  verdicts: Record<string, Verdict>;
}

export function Report({ report }: { report: ScanReport }) {
  const [a, setA] = useState<Assumptions>(() => defaultAssumptions(report));
  const [copied, setCopied] = useState(false);
  const [deep, setDeep] = useState<DeepState>({ status: "unknown", verdicts: {} });
  const t = useMemo(() => totals(report.findings, a), [report.findings, a]);
  const groups = useMemo(() => {
    const g = new Map<PatternId, Finding[]>();
    for (const id of PATTERN_ORDER) {
      const list = report.findings.filter((f) => f.pattern === id);
      if (list.length) g.set(id, list);
    }
    return g;
  }, [report.findings]);

  useEffect(() => {
    let alive = true;
    fetch("/api/deep-read")
      .then((r) => r.json())
      .then((d: { enabled: boolean; model: string | null; maxFindings: number }) => alive && setDeep((s) => ({ ...s, status: d.enabled ? "ready" : "off", model: d.model, maxFindings: d.maxFindings })))
      .catch(() => alive && setDeep((s) => ({ ...s, status: "off" })));
    return () => {
      alive = false;
    };
  }, []);

  const noLlm = report.stats.llmCallSites === 0;
  const incomplete = report.errors.length > 0;
  const counted = report.findings.filter((f) => f.confidence !== "low");
  const lowOnly = report.findings.length - counted.length;
  const unpricedModels = [...new Set(report.findings.filter((f) => f.model && !findPrice(f.model)).map((f) => f.model as string))];

  const copy = async () => {
    const md = toMarkdown(report, a, deep.verdicts);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "leanfetch-report.md";
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const runDeep = async () => {
    const top = report.findings.filter((f) => f.callKind !== "http").slice(0, deep.maxFindings ?? 10);
    if (!top.length) return;
    setDeep((s) => ({ ...s, status: "running", error: undefined }));
    try {
      const res = await fetch("/api/deep-read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ findings: top.map(candidateFromFinding) }) });
      const data = await res.json();
      if (!res.ok) {
        setDeep((s) => ({ ...s, status: "error", error: data.error ?? `deep read failed (${res.status})` }));
        return;
      }
      const verdicts: Record<string, Verdict> = {};
      for (const v of data.verdicts as Verdict[]) verdicts[v.id] = v;
      setDeep((s) => ({ ...s, status: "done", summary: data.summary, verdicts }));
    } catch {
      setDeep((s) => ({ ...s, status: "error", error: "could not reach the server" }));
    }
  };

  const ghBase = report.source.kind === "github" ? `https://github.com/${report.source.owner}/${report.source.repo}/blob/${report.source.ref}/` : null;

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3 font-mono text-[12px] text-muted">
        <span className="text-ink">{sourceLabel(report)}</span>
        <span>
          {report.stats.filesScanned} files · {report.stats.llmCallSites} llm calls · {report.stats.httpCallSites} http calls · {(report.durationMs / 1000).toFixed(1)}s
        </span>
      </div>

      {incomplete && (
        <div className="mt-6 rounded-lg border border-accent/40 p-4 text-[14px]" role="alert">
          <p className="font-mono text-[12px] uppercase tracking-wider text-accent">incomplete scan</p>
          <p className="mt-1 text-ink">{report.errors.length} analysis steps failed, so this report may be missing findings. do not read it as clean.</p>
          <p className="mt-1 font-mono text-[12px] text-muted">{report.errors.slice(0, 4).join(" · ")}</p>
        </div>
      )}

      {noLlm ? (
        <div className="py-12">
          <p className="font-serif text-[44px] leading-none text-ink sm:text-[56px]">nothing to save here.</p>
          <p className="mt-4 max-w-xl text-[15px] text-muted">
            we found no llm api calls in {report.stats.filesScanned} source files{report.stats.httpCallSites ? `, so only the ${report.stats.httpCallSites} generic http calls were checked` : ""}. that is an honest empty result, not a failed scan.
          </p>
        </div>
      ) : (
        <div className="grid gap-8 py-10 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="font-mono text-[12px] uppercase tracking-wider text-muted">estimated monthly waste</p>
            <p className="mt-2 font-serif text-[52px] leading-[0.95] text-ink sm:text-[72px]">
              {t.high === 0 ? "$0" : (
                <>
                  {money(t.low)}
                  <span className="text-faint"> to </span>
                  <span className="text-accent">{money(t.high)}</span>
                </>
              )}
            </p>
            <p className="mt-3 max-w-xl text-[14px] text-muted">
              {report.findings.length === 0
                ? `no wasteful patterns found across ${report.stats.llmCallSites} llm call sites.`
                : `${counted.length} findings count toward this at the assumptions below${lowOnly ? `, ${lowOnly} low confidence ones do not` : ""}. each call site counts once.`}
              {t.unpricedFindings > 0 && ` ${t.unpricedFindings} findings are not in dollars (requests, or pricing not available).`}
            </p>
          </div>
          <div className="flex gap-2 md:flex-col">
            <button onClick={copy} className="rounded-lg border border-line-strong px-4 py-2 font-mono text-[13px] text-ink hover:border-ink">
              {copied ? "copied" : "copy report as markdown"}
            </button>
          </div>
        </div>
      )}

      {report.notes.length > 0 && (
        <ul className="mb-6 space-y-1 font-mono text-[12px] text-muted">
          {report.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}

      {!noLlm && <AssumptionsPanel a={a} setA={setA} unpricedModels={unpricedModels} />}

      {groups.size > 0 && (
        <div className="mt-10">
          <h2 className="font-mono text-[12px] uppercase tracking-wider text-muted">by pattern</h2>
          <table className="mt-3 w-full text-[14px]">
            <tbody>
              {[...groups].map(([id, list]) => {
                const s = list.reduce(
                  (acc, f) => {
                    const e = estimate(f, a);
                    return e.priced && f.confidence !== "low" ? { low: acc.low + e.low, high: acc.high + e.high, priced: true } : acc;
                  },
                  { low: 0, high: 0, priced: false },
                );
                return (
                  <tr key={id} className="border-t border-line">
                    <td className="py-2 pr-3">
                      <a href={`#p-${id}`} className="text-ink hover:underline">
                        {PATTERNS[id].name}
                      </a>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-[13px] text-muted">{list.length}</td>
                    <td className="py-2 text-right font-mono text-[13px] text-ink">{s.priced ? `${money(s.low)} to ${money(s.high)}` : <span className="text-faint">requests</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-faint">per-pattern sums can overlap on the same call site; the headline counts each site once.</p>
        </div>
      )}

      {report.findings.length > 0 && <DeepRead deep={deep} run={runDeep} count={Math.min(report.findings.filter((f) => f.callKind !== "http").length, deep.maxFindings ?? 10)} />}

      {[...groups].map(([id, list]) => (
        <div key={id} id={`p-${id}`} className="mt-14 scroll-mt-6">
          <div className="border-b border-line pb-3">
            <h2 className="font-serif text-[30px] leading-tight text-ink">
              {PATTERNS[id].name} <span className="font-mono text-[14px] text-faint">{list.length}</span>
            </h2>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">{PATTERNS[id].why}</p>
          </div>
          <div className="divide-y divide-line">
            {list.map((f) => (
              <FindingCard key={f.id} f={f} a={a} verdict={deep.verdicts[f.id]} href={ghBase ? `${ghBase}${f.file}#L${f.startLine}-L${f.endLine}` : undefined} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function NumberField({ label, value, onChange, step }: { label: string; value: number; onChange: (n: number) => void; step: number }) {
  return (
    <label className="block">
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="mt-1 w-full rounded-md border border-line-strong bg-bg px-2.5 py-2 font-mono text-[14px] text-ink outline-none focus:border-ink"
      />
    </label>
  );
}

function AssumptionsPanel({ a, setA, unpricedModels }: { a: Assumptions; setA: (a: Assumptions) => void; unpricedModels: string[] }) {
  const price = findPrice(a.model);
  const providers = ["anthropic", "openai", "google"] as const;
  return (
    <details open className="rounded-xl border border-line bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[12px] uppercase tracking-wider text-muted sm:px-5">assumptions · change these, the numbers update</summary>
      <div className="border-t border-line px-4 pb-5 pt-4 sm:px-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField label="calls / day / site" value={a.callsPerDay} step={100} onChange={(n) => setA({ ...a, callsPerDay: n })} />
          <NumberField label="input tokens" value={a.inputTokens} step={100} onChange={(n) => setA({ ...a, inputTokens: n })} />
          <NumberField label="output tokens" value={a.outputTokens} step={50} onChange={(n) => setA({ ...a, outputTokens: n })} />
          <label className="col-span-2 block sm:col-span-1">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted">model</span>
            <select value={a.model} onChange={(e) => setA({ ...a, model: e.target.value })} className="mt-1 w-full rounded-md border border-line-strong bg-bg px-2 py-2 font-mono text-[13px] text-ink outline-none focus:border-ink">
              {providers.map((p) => (
                <optgroup key={p} label={p}>
                  {PRICES.filter((x) => x.provider === p && x.kind !== "embed").map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.id}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-4 flex items-start gap-2 text-[13px] text-muted">
          <input type="checkbox" checked={a.useDetectedModel} onChange={(e) => setA({ ...a, useDetectedModel: e.target.checked })} className="mt-0.5 accent-[var(--ink)]" />
          <span>use the model found in each call when we know its price. calls with no detected model use the model above.</span>
        </label>
        {a.useDetectedModel && unpricedModels.length > 0 && (
          <p className="mt-2 text-[13px] text-warn">pricing not available for {unpricedModels.join(", ")}. those findings show no dollar amount. untick the box to price them as {a.model}.</p>
        )}
        <div className="mt-4 rounded-md bg-code p-3 font-mono text-[12px] leading-relaxed text-muted">
          <p>monthly cost of one call site = calls/day x 30 x (input tokens x input price + output tokens x output price) / 1m</p>
          {price && (
            <p className="text-ink">
              {a.model}: ${price.input} in / ${price.output} out per 1m tokens{price.cachedInput !== undefined ? `, cache read $${price.cachedInput}` : ""} → {money(((a.inputTokens * price.input + a.outputTokens * price.output) / 1e6) * a.callsPerDay * 30)}/mo per site
            </p>
          )}
          <p>waste = that cost x a pattern-specific share (shown on each finding). low confidence findings and http-only findings are left out of the total.</p>
        </div>
        <p className="mt-3 text-[12px] text-faint">
          prices as of {PRICING_AS_OF} from{" "}
          {PRICING_SOURCES.map((s, i) => (
            <span key={s.url}>
              {i > 0 && ", "}
              <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
                {s.provider}
              </a>
            </span>
          ))}
          . models not in the table get no dollar figure.
        </p>
      </div>
    </details>
  );
}

function DeepRead({ deep, run, count }: { deep: DeepState; run: () => void; count: number }) {
  if (deep.status === "unknown") return null;
  return (
    <div className="mt-10 rounded-xl border border-line p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[12px] uppercase tracking-wider text-muted">deep read</p>
          <p className="mt-1 text-[14px] text-ink">
            {deep.status === "off"
              ? "off on this deploy. the static report above is complete without it."
              : `send the top ${count} snippets to claude (${deep.model}) to confirm or reject each finding and write a summary. capped input, a few per day.`}
          </p>
        </div>
        {deep.status !== "off" && (
          <button onClick={run} disabled={deep.status === "running" || deep.status === "done" || count === 0} className="shrink-0 rounded-lg bg-ink px-4 py-2 font-mono text-[13px] text-bg disabled:opacity-40">
            {deep.status === "running" ? "reading" : deep.status === "done" ? "done" : "run deep read"}
          </button>
        )}
      </div>
      {deep.status === "error" && <p className="mt-3 text-[13px] text-accent">{deep.error}</p>}
      {deep.summary && <p className="mt-4 border-t border-line pt-4 text-[14px] leading-relaxed text-ink">{deep.summary}</p>}
    </div>
  );
}
