import { candidateFromFinding } from '@/lib/deepread-client';

export function progressSteps(event, sourceType) {
  const d = event.detail || '';
  switch (event.step) {
    case 'resolving':
      return [{ phase: 'fetch', message: `Resolving default branch for ${d}...` }];
    case 'downloading':
      return [
        { phase: 'fetch', done: true, message: `Resolved ${d}` },
        { phase: 'structural', message: 'Downloading repository archive...' },
      ];
    case 'analyzing':
      return [
        { phase: sourceType === 'files' ? 'fetch' : 'structural', done: true, message: sourceType === 'files' ? 'Uploaded files' : 'Downloaded and filtered archive' },
        { phase: 'content', message: `Running detectors on ${d}...` },
      ];
    case 'estimating':
      return [
        { phase: 'content', done: true, message: `Detectors complete (${d})` },
        { phase: 'triage', message: 'Estimating savings...' },
      ];
    default:
      return [];
  }
}

export async function runDeepRead(report, push) {
  const top = report.flags.filter((f) => f.finding.callKind !== 'http').slice(0, 10);
  push({ phase: 'deepScan', message: `Deep read: Claude is reviewing the top ${top.length} flag${top.length === 1 ? '' : 's'}...` });
  try {
    const res = await fetch('/api/deep-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ findings: top.map((f) => candidateFromFinding(f.finding)) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      push({ phase: 'deepScan', done: true, message: 'Deep read skipped' });
      return { ...report, deepReadError: data.error || `Deep read failed (${res.status})` };
    }
    const byId = new Map((data.verdicts || []).map((v) => [v.id, v]));
    push({ phase: 'deepScan', done: true, message: `Deep read complete (${byId.size} verdicts)` });
    return {
      ...report,
      flags: report.flags.map((f) => (byId.has(f.id) ? { ...f, verdict: byId.get(f.id) } : f)),
      deepReadSummary: data.summary,
      deepReadModel: data.model,
      tokenUsage: {
        ...report.tokenUsage,
        deepScan: { input: data.usage?.input || 0, output: data.usage?.output || 0, cacheRead: data.usage?.cacheRead || 0, cacheCreation: data.usage?.cacheWrite || 0 },
      },
    };
  } catch {
    push({ phase: 'deepScan', done: true, message: 'Deep read skipped' });
    return { ...report, deepReadError: 'Could not reach the server for the deep read.' };
  }
}
