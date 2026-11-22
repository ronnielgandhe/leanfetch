import { calculateCost } from './api';

export default function SummaryBar({ summary, tokenUsage, deepReadModel }) {
  const costs = calculateCost(tokenUsage, deepReadModel);

  return (
    <div className="bg-white border border-[rgba(0,0,0,0.06)] p-6">
      <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-4">Scan Complete</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6 text-center">
        <Stat label="Files scanned" value={summary.filesScanned} />
        <Stat label="Files analyzed" value={summary.filesAnalyzed} />
        <Stat
          label="Critical"
          value={summary.critical}
          color={summary.critical > 0 ? 'text-[#DC2626]' : 'text-[rgba(26,26,26,0.3)]'}
        />
        <Stat
          label="Warnings"
          value={summary.warning}
          color={summary.warning > 0 ? 'text-[#D97706]' : 'text-[rgba(26,26,26,0.3)]'}
        />
        <Stat label="Info" value={summary.info} color="text-[#2563EB]" />
      </div>
      <div className="mt-4 pt-4 border-t border-[rgba(0,0,0,0.06)] flex items-center justify-between text-xs text-[rgba(26,26,26,0.4)]">
        <span>Total flags: {summary.totalFlags}</span>
        <span>Scan cost: ${costs.total.toFixed(4)}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, color = 'text-[#1A1A1A]' }) {
  return (
    <div>
      <div className={`text-[36px] font-light tracking-tight ${color}`}>{value}</div>
      <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mt-1">{label}</div>
    </div>
  );
}
