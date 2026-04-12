const PHASE_ORDER = ['fetch', 'structural', 'content', 'keyword', 'triage', 'deepScan', 'parse', 'analysis', 'synthesis'];

const HEADINGS = {
  github: 'Scanning repository',
  files: 'Scanning uploaded files',
  plan: 'Analyzing design document',
};

export default function ProgressLog({ steps, sourceType }) {
  const phaseMap = new Map();
  for (const step of steps) {
    if (step.done) {
      phaseMap.set(step.phase + '_done', step);
    } else {
      phaseMap.set(step.phase, step);
    }
  }

  const display = [];
  for (const phase of PHASE_ORDER) {
    const done = phaseMap.get(phase + '_done');
    const active = phaseMap.get(phase);
    if (done) display.push({ ...done, status: 'done' });
    if (active && !active.done) display.push({ ...active, status: 'active' });
  }

  return (
    <div className="bg-white border border-[rgba(0,0,0,0.06)] p-6">
      <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-4">
        {HEADINGS[sourceType] || 'Scanning'}
      </p>
      <div className="space-y-1.5 font-mono text-sm">
        {display.map((step, i) => {
          const isLast = i === display.length - 1;
          const prefix = isLast ? '\u2514\u2500\u2500' : '\u251C\u2500\u2500';
          const icon = step.status === 'done' ? '\u2713' : '\u2192';
          const textColor = step.status === 'done' ? 'text-[rgba(26,26,26,0.45)]' : 'text-[#1A1A1A] font-medium';

          return (
            <div key={step.phase + step.status} className={`flex items-start gap-1.5 ${textColor}`}>
              <span className="text-[rgba(26,26,26,0.25)] select-none">{prefix}</span>
              <span className={step.status === 'done' ? 'text-[rgba(26,26,26,0.35)]' : 'text-[#1A1A1A]'}>{icon}</span>
              <span className="flex-1">{step.message}</span>
              {step.current != null && step.total != null && step.status === 'active' && (
                <span className="text-[rgba(26,26,26,0.35)]">
                  [{step.current}/{step.total}]
                </span>
              )}
            </div>
          );
        })}
        {display.length > 0 && display[display.length - 1].status === 'active' && (
          <div className="flex items-center gap-1 text-[rgba(26,26,26,0.3)] ml-8 mt-1">
            <span className="animate-pulse">...</span>
          </div>
        )}
      </div>
    </div>
  );
}
