import { calculateCost } from './api';

export default function CostBreakdown({ tokenUsage, deepReadModel }) {
  const costs = calculateCost(tokenUsage, deepReadModel);

  return (
    <div className="bg-white border border-[rgba(0,0,0,0.06)] p-6">
      <h3 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-4">Scan Cost Breakdown</h3>
      <div className="font-mono text-xs space-y-2">
        <Row
          label="Static analysis (free)"
          input={tokenUsage.triage.input}
          output={tokenUsage.triage.output}
          cacheRead={tokenUsage.triage.cacheRead}
          cost={costs.triage}
        />
        <Row
          label={`Deep read (${deepReadModel || 'not run'})`}
          input={tokenUsage.deepScan.input}
          output={tokenUsage.deepScan.output}
          cacheRead={tokenUsage.deepScan.cacheRead}
          cost={costs.deepScan}
        />
        <div className="border-t border-[rgba(0,0,0,0.06)] pt-2 mt-3 flex justify-between text-[#1A1A1A]">
          <span className="font-medium">Total</span>
          <span>
            {fmt(tokenUsage.triage.input + tokenUsage.deepScan.input + tokenUsage.synthesis.input)} in /{' '}
            {fmt(tokenUsage.triage.output + tokenUsage.deepScan.output + tokenUsage.synthesis.output)} out
            <span className="font-medium ml-3">${costs.total.toFixed(4)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, input, output, cacheRead, cost }) {
  return (
    <div className="flex justify-between text-[rgba(26,26,26,0.6)]">
      <span className="text-[rgba(26,26,26,0.4)]">{label}</span>
      <span>
        {fmt(input)} in / {fmt(output)} out
        {cacheRead > 0 && <span className="text-[rgba(26,26,26,0.35)] ml-1">({fmt(cacheRead)} cached)</span>}
        <span className="text-[#1A1A1A] ml-3">${cost.toFixed(4)}</span>
      </span>
    </div>
  );
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
