import { useMemo } from 'react';
import { estimateFlag, fmtMoney, totals as siteTotals } from '@/lib/ui/adapter';
import { PRICES, PRICING_AS_OF, PRICING_SOURCES } from '@/lib/pricing';

export default function SavingsSimulator({ flags, assumptions, setAssumptions }) {
  const a = assumptions;
  const callVolume = a.callsPerDay;
  const setCallVolume = (v) => setAssumptions({ ...a, callsPerDay: v });

  const estimates = useMemo(() => flags.map((flag) => ({
    ...flag,
    estimate: estimateFlag(flag, a),
  })), [flags, a]);

  const totals = useMemo(() => {
    const sites = new Map();
    for (const { estimate, finding } of estimates) {
      if (!estimate.priced || finding.confidence === 'low') continue;
      const cur = sites.get(finding.siteKey);
      if (!cur || estimate.monthlyBase > cur) sites.set(finding.siteKey, estimate.monthlyBase);
    }
    let before = 0;
    for (const v of sites.values()) before += v;
    const t = siteTotals(flags.map((f) => f.finding), a);
    return {
      before,
      afterLow: Math.max(0, before - t.high),
      afterHigh: Math.max(0, before - t.low),
      savedLow: t.low,
      savedHigh: t.high,
      pctLow: before > 0 ? Math.round((t.low / before) * 100) : 0,
      pctHigh: before > 0 ? Math.round((t.high / before) * 100) : 0,
      unpriced: t.unpricedFindings,
    };
  }, [estimates, flags, a]);

  const presets = [100, 1000, 10000, 100000];
  const numberClass = 'w-28 text-xs bg-white border border-[rgba(0,0,0,0.1)] px-3 py-2 text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A]';
  const range = (lo, hi, unit = '') => (Math.abs(hi - lo) < 0.005 ? `$${fmtMoney(hi)}${unit}` : `$${fmtMoney(lo)} to $${fmtMoney(hi)}${unit}`);

  return (
    <div className="bg-white border border-[rgba(0,0,0,0.06)] p-6 space-y-6">
      <div>
        <h3 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-1">Savings Simulator</h3>
        <p className="text-xs text-[rgba(26,26,26,0.4)]">Estimates based on published model pricing and assumed ~{a.inputTokens.toLocaleString('en-US')} input / ~{a.outputTokens.toLocaleString('en-US')} output tokens per call. Change any assumption and the numbers update.</p>
      </div>

      {/* Volume selector */}
      <div>
        <label className="text-[13px] font-medium text-[rgba(26,26,26,0.4)] block mb-2">Simulated call volume <span className="text-[rgba(26,26,26,0.3)] font-normal">(calls per day, per flagged call site)</span></label>
        <div className="flex gap-2 flex-wrap">
          {presets.map((v) => (
            <button
              key={v}
              onClick={() => setCallVolume(v)}
              className={`text-[13px] font-medium px-4 py-2 transition-colors ${
                callVolume === v
                  ? 'bg-[#1A1A1A] text-white'
                  : 'border border-[rgba(0,0,0,0.1)] text-[rgba(26,26,26,0.5)] hover:border-[rgba(0,0,0,0.2)] hover:text-[#1A1A1A]'
              }`}
            >
              {fmtNum(v)} calls
            </button>
          ))}
          <input
            type="number"
            value={callVolume}
            onChange={(e) => setCallVolume(Math.max(1, parseInt(e.target.value) || 0))}
            className={numberClass}
          />
        </div>
      </div>

      {/* Token and model assumptions */}
      <div className="flex gap-6 flex-wrap items-end">
        <div>
          <label className="text-[13px] font-medium text-[rgba(26,26,26,0.4)] block mb-2">Input tokens / call</label>
          <input type="number" value={a.inputTokens} onChange={(e) => setAssumptions({ ...a, inputTokens: Math.max(0, parseInt(e.target.value) || 0) })} className={numberClass} />
        </div>
        <div>
          <label className="text-[13px] font-medium text-[rgba(26,26,26,0.4)] block mb-2">Output tokens / call</label>
          <input type="number" value={a.outputTokens} onChange={(e) => setAssumptions({ ...a, outputTokens: Math.max(0, parseInt(e.target.value) || 0) })} className={numberClass} />
        </div>
        <div>
          <label className="text-[13px] font-medium text-[rgba(26,26,26,0.4)] block mb-2">Model</label>
          <select value={a.model} onChange={(e) => setAssumptions({ ...a, model: e.target.value })} className="text-xs bg-white border border-[rgba(0,0,0,0.1)] px-3 py-2 text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A]">
            {['anthropic', 'openai', 'google'].map((p) => (
              <optgroup key={p} label={p}>
                {PRICES.filter((x) => x.provider === p && x.kind !== 'embed').map((x) => (
                  <option key={x.id} value={x.id}>{x.id}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <label className="text-xs text-[rgba(26,26,26,0.5)] flex items-center gap-2 pb-2">
          <input type="checkbox" checked={a.useDetectedModel} onChange={(e) => setAssumptions({ ...a, useDetectedModel: e.target.checked })} className="accent-[#1A1A1A]" />
          Use the model found in each call when it is priced
        </label>
      </div>

      {/* Before / After comparison */}
      <div className="grid grid-cols-3 gap-4">
        <SimCard label="Before LeanFetch" value={`$${fmtMoney(totals.before)}`} sub="per month, flagged call sites" color="text-[#DC2626]" />
        <SimCard label="After LeanFetch" value={range(totals.afterLow, totals.afterHigh)} sub="per month" color="text-[#1A1A1A]" />
        <SimCard label="Total Saved" value={range(totals.savedLow, totals.savedHigh)} sub={totals.pctLow === totals.pctHigh ? `${totals.pctHigh}% reduction` : `${totals.pctLow}-${totals.pctHigh}% reduction`} color="text-[#1A1A1A]" />
      </div>

      {/* Per-flag breakdown */}
      <div>
        <h4 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-3">Per-flag breakdown</h4>
        <div className="space-y-1.5 font-mono text-xs">
          {estimates.map((item, i) => {
            const e = item.estimate;
            return (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-[rgba(0,0,0,0.04)] last:border-0">
                <div className="flex-1 min-w-0">
                  <span className={`inline-block w-16 text-center text-[10px] font-medium px-1 py-0.5 mr-2 ${
                    item.severity === 'critical' ? 'bg-red-50 text-[#DC2626]'
                    : item.severity === 'warning' ? 'bg-amber-50 text-[#D97706]'
                    : 'bg-blue-50 text-[#2563EB]'
                  }`}>{item.severity}</span>
                  <span className="text-[rgba(26,26,26,0.6)] truncate">{item.title?.slice(0, 50)}</span>
                </div>
                {e.priced ? (
                  <div className="flex items-center gap-3 text-right shrink-0 ml-2">
                    <span className="text-[#DC2626]/60">${fmtMoney(e.monthlyBase)}</span>
                    <span className="text-[rgba(26,26,26,0.2)]">&rarr;</span>
                    <span className="text-[rgba(26,26,26,0.7)]">${fmtMoney(e.monthlyBase - e.monthlyHigh)}</span>
                    <span className="text-[rgba(26,26,26,0.5)] w-16 text-right">-{e.lowPercent === e.savingsPercent ? e.savingsPercent : `${e.lowPercent}-${e.savingsPercent}`}%</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-right shrink-0 ml-2">
                    <span className="text-[rgba(26,26,26,0.35)]">{item.finding.callKind === 'http' || item.finding.pattern === 'unbatched-embeddings' || item.finding.pattern === 'polling-no-backoff' || item.finding.pattern === 'duplicate-fetch' ? 'requests, not dollars' : 'pricing not available'}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-[10px] text-[rgba(26,26,26,0.3)] leading-relaxed">
        Monthly cost of one call site = calls/day x 30 x (input tokens x input price + output tokens x output price) / 1M. Savings = that cost x a pattern-specific share shown on each flag.
        Totals count each call site once and leave out low confidence flags{totals.unpriced ? ` and ${totals.unpriced} flag${totals.unpriced === 1 ? '' : 's'} with no dollar figure` : ''}.
        Prices as of {PRICING_AS_OF} from {PRICING_SOURCES.map((s, i) => (
          <span key={s.url}>{i > 0 ? ', ' : ''}<a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.provider}</a></span>
        ))}. Models not in the table get no dollar figure. These estimates are directional, not precise.
      </p>
    </div>
  );
}

function SimCard({ label, value, sub, color }) {
  return (
    <div className="bg-[#F8F8F6] border border-[rgba(0,0,0,0.06)] p-5 text-center">
      <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-2">{label}</div>
      <div className={`text-[24px] font-light tracking-tight ${color}`}>{value}</div>
      <div className="text-[10px] text-[rgba(26,26,26,0.4)] mt-1">{sub}</div>
    </div>
  );
}

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}
