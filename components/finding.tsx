"use client";

import { useState } from "react";
import { PATTERNS } from "@/lib/patterns";
import { estimate, money, type Assumptions } from "@/lib/savings";
import type { Finding, Level } from "@/lib/types";

export interface Verdict {
  id: string;
  verdict: "confirmed" | "rejected" | "unsure";
  reason: string;
}

const SEV: Record<Level, string> = { high: "bg-accent", medium: "bg-warn", low: "bg-faint" };

export function FindingCard({ f, a, verdict, href }: { f: Finding; a: Assumptions; verdict?: Verdict; href?: string }) {
  const [showFix, setShowFix] = useState(false);
  const [showMath, setShowMath] = useState(false);
  const meta = PATTERNS[f.pattern];
  const lang = f.file.endsWith(".py") ? "py" : "js";
  const e = estimate(f, a);
  const loc = `${f.file}:${f.startLine}${f.endLine !== f.startLine ? `-${f.endLine}` : ""}`;
  return (
    <article className={`py-6 ${verdict?.verdict === "rejected" ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-muted">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${SEV[f.severity]}`} aria-hidden />
          {f.severity} severity
        </span>
        <span>{f.confidence} confidence</span>
        {f.model && <span className="normal-case tracking-normal">{f.model}</span>}
        {verdict && (
          <span className={verdict.verdict === "confirmed" ? "text-ok" : verdict.verdict === "rejected" ? "text-accent" : "text-warn"}>claude: {verdict.verdict}</span>
        )}
      </div>
      <h3 className="mt-2 text-[17px] font-medium leading-snug text-ink">{f.title}</h3>
      <p className="mt-1 break-all font-mono text-[12px] text-muted">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
            {loc}
          </a>
        ) : (
          loc
        )}
      </p>

      <pre className="mt-3 overflow-x-auto rounded-lg bg-code py-2 font-mono text-[12.5px] leading-[1.6]">
        {f.snippet.map((l, i) =>
          l.n < 0 ? (
            <div key={i} className="px-3 text-faint">
              ⋯
            </div>
          ) : (
            <div key={i} className={`flex border-l-2 pr-3 ${l.hot ? "border-hot-edge bg-hot" : "border-transparent"}`}>
              <span className="w-12 shrink-0 select-none pr-3 text-right text-faint">{l.n}</span>
              <span className="whitespace-pre text-ink">{l.text || " "}</span>
            </div>
          ),
        )}
      </pre>

      <ul className="mt-3 space-y-1 text-[13px] text-muted">
        {f.evidence.map((ev) => (
          <li key={ev} className="flex gap-2">
            <span className="text-faint">·</span>
            <span>{ev}</span>
          </li>
        ))}
      </ul>
      {verdict && <p className="mt-2 text-[13px] text-ink">claude: {verdict.reason}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
        <div>
          <p className="text-[14px] text-ink">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted">fix </span>
            {meta.fix}
            {f.suggestedModel && ` try ${f.suggestedModel}.`}
          </p>
          <button onClick={() => setShowFix((v) => !v)} className="mt-2 font-mono text-[12px] text-muted underline underline-offset-4 hover:text-ink">
            {showFix ? "hide example" : "show before / after"}
          </button>
        </div>
        <div className="font-mono text-[13px] sm:text-right">
          {e.priced ? (
            <button onClick={() => setShowMath((v) => !v)} className="text-left sm:text-right" title="show the math">
              <span className="text-ink">
                {money(e.low)} to {money(e.high)}
              </span>
              <span className="text-faint"> /mo</span>
              <span className="block text-[11px] text-faint underline underline-offset-2">{f.confidence === "low" ? "not in total · " : ""}show math</span>
            </button>
          ) : (
            <span className="text-faint">{e.requestsNote ?? e.reason}</span>
          )}
        </div>
      </div>
      {showMath && e.priced && (
        <p className="mt-3 rounded-md bg-code p-3 font-mono text-[11.5px] leading-relaxed text-muted">
          {e.formula}
          <br />
          {meta.savingsWhy}
        </p>
      )}
      {showFix && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {(["before", "after"] as const).map((k) => (
            <div key={k}>
              <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-muted">{k}</p>
              <pre className="overflow-x-auto rounded-lg bg-code p-3 font-mono text-[12px] leading-[1.6] text-ink">{meta.example[lang][k]}</pre>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
