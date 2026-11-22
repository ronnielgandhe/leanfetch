"use client";

import { useCallback, useRef, useState } from "react";
import { readPicked, type PickedFiles } from "@/lib/client/files";
import type { ScanEvent, ScanReport } from "@/lib/types";
import { Report } from "./report";

const EXAMPLES = [
  { repo: "yoheinakajima/babyagi", note: "python agent" },
  { repo: "mckaywrigley/chatbot-ui", note: "next.js chat app" },
  { repo: "sindresorhus/slugify", note: "no llm at all" },
];

const STEPS: Record<string, string> = {
  resolving: "finding the default branch",
  downloading: "downloading the repo archive",
  analyzing: "running the detectors",
  estimating: "pricing the findings",
  reading: "reading your files",
  uploading: "sending files",
};

type State =
  | { kind: "idle" }
  | { kind: "running"; steps: { step: string; detail?: string }[] }
  | { kind: "done"; report: ScanReport }
  | { kind: "error"; message: string; code?: string };

export function Scanner() {
  const [tab, setTab] = useState<"repo" | "upload">("repo");
  const [repo, setRepo] = useState("");
  const [picked, setPicked] = useState<PickedFiles | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const running = state.kind === "running";

  const scan = useCallback(async (body: unknown, firstStep: string) => {
    setState({ kind: "running", steps: [{ step: firstStep }] });
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    let res: Response;
    try {
      res = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      setState({ kind: "error", message: "could not reach the server. check your connection and try again." });
      return;
    }
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      setState({ kind: "error", message: data.error ?? `scan failed (${res.status})`, code: res.status === 429 ? "rate_limited" : data.code });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finished = false;
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (value) buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: ScanEvent;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "progress") setState((s) => (s.kind === "running" ? { kind: "running", steps: [...s.steps, { step: ev.step, detail: ev.detail }] } : s));
        else if (ev.type === "report") {
          finished = true;
          setState({ kind: "done", report: ev.report });
        } else if (ev.type === "error") {
          finished = true;
          setState({ kind: "error", message: ev.message, code: ev.code });
        }
      }
      if (done) break;
    }
    if (!finished) setState({ kind: "error", message: "the scan stopped before it finished (the server may have timed out). no report was produced, so do not read this as clean." });
  }, []);

  const scanRepo = (value = repo) => {
    if (!value.trim() || running) return;
    setRepo(value);
    void scan({ kind: "github", repo: value.trim() }, "starting");
  };

  const onFiles = async (list: FileList | File[] | null) => {
    if (!list || !list.length) return;
    setPickError(null);
    try {
      const p = await readPicked([...list]);
      if (!p.files.length) {
        setPicked(null);
        setPickError("no .js, .ts or .py source files in that selection.");
        return;
      }
      setPicked(p);
    } catch (e) {
      setPicked(null);
      setPickError(e instanceof Error ? e.message : "could not read those files");
    }
  };

  const scanUpload = () => {
    if (!picked || running) return;
    void scan({ kind: "upload", name: picked.name, files: picked.files }, "uploading");
  };

  return (
    <div>
      <div className="rounded-xl border border-line bg-surface">
        <div role="tablist" className="flex border-b border-line px-2 pt-2 font-mono text-[13px]">
          {(["repo", "upload"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`-mb-px rounded-t-md border-b-2 px-3 pb-2 pt-1 transition-colors ${tab === t ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t === "repo" ? "github repo" : "upload code"}
            </button>
          ))}
        </div>

        {tab === "repo" ? (
          <div className="p-4 sm:p-5">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                scanRepo();
              }}
            >
              <label htmlFor="repo" className="sr-only">
                github repo url
              </label>
              <input
                id="repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="github.com/owner/repo"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-lg border border-line-strong bg-bg px-3 py-2.5 font-mono text-[14px] text-ink outline-none placeholder:text-faint focus:border-ink"
              />
              <button type="submit" disabled={running || !repo.trim()} className="rounded-lg bg-ink px-5 py-2.5 font-mono text-[14px] text-bg transition-opacity disabled:opacity-40">
                {running ? "scanning" : "scan"}
              </button>
            </form>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[12px] text-muted">
              <span>try</span>
              {EXAMPLES.map((ex) => (
                <button key={ex.repo} onClick={() => scanRepo(ex.repo)} disabled={running} className="group text-left disabled:opacity-50">
                  <span className="text-ink underline decoration-line-strong underline-offset-4 group-hover:decoration-ink">{ex.repo}</span>
                  <span className="text-faint"> {ex.note}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void onFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${drag ? "border-ink bg-bg" : "border-line-strong hover:border-ink"}`}
            >
              <p className="text-[15px] text-ink">drop source files or a .zip here</p>
              <p className="mt-1 font-mono text-[12px] text-muted">js, ts and python. read in your browser, only source text is sent. up to 3mb.</p>
              <input ref={fileInput} type="file" multiple accept=".js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.zip" className="hidden" onChange={(e) => void onFiles(e.target.files)} />
            </div>
            {pickError && <p className="mt-3 font-mono text-[12px] text-accent">{pickError}</p>}
            {picked && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-mono text-[12px] text-muted">
                  {picked.files.length} source files, {(picked.bytes / 1024).toFixed(0)}kb{picked.skipped ? `, ${picked.skipped} skipped` : ""}
                </p>
                <button onClick={scanUpload} disabled={running} className="rounded-lg bg-ink px-5 py-2.5 font-mono text-[14px] text-bg disabled:opacity-40">
                  {running ? "scanning" : "scan files"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div ref={resultRef} className="scroll-mt-6">
        {state.kind === "running" && <Progress steps={state.steps} />}
        {state.kind === "error" && <ErrorBox message={state.message} code={state.code} />}
        {state.kind === "done" && <Report report={state.report} />}
      </div>
    </div>
  );
}

function Progress({ steps }: { steps: { step: string; detail?: string }[] }) {
  return (
    <div className="mt-10 font-mono text-[13px]" aria-live="polite">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <div key={i} className="flex gap-3 py-1">
            <span className={last ? "pulse-dot text-accent" : "text-ok"}>{last ? "●" : "✓"}</span>
            <span className={last ? "text-ink" : "text-muted"}>
              {STEPS[s.step] ?? s.step}
              {s.detail && <span className="text-faint"> · {s.detail}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ErrorBox({ message, code }: { message: string; code?: string }) {
  const limited = code === "rate_limited";
  return (
    <div className={`mt-10 rounded-xl border p-5 ${limited ? "border-warn/40" : "border-accent/40"}`} role="alert">
      <p className={`font-mono text-[12px] uppercase tracking-wider ${limited ? "text-warn" : "text-accent"}`}>{limited ? "rate limited" : "scan failed"}</p>
      <p className="mt-2 text-[15px] text-ink">{message}</p>
      {!limited && <p className="mt-2 text-[13px] text-muted">no report was produced. this is not a clean result.</p>}
    </div>
  );
}
