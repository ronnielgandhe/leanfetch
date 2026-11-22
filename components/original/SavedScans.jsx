import { deleteScan } from './scanStore';

export default function SavedScans({ onLoad, scans, onRefresh }) {
  if (!scans || scans.length === 0) return null;

  const handleDelete = (id) => {
    deleteScan(id);
    onRefresh();
  };

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const repoName = (url) => {
    const match = url.match(/([^/]+\/[^/]+)$/);
    return match ? match[1] : url;
  };

  return (
    <div className="mt-10">
      <h3 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-4">
        Saved Scans ({scans.length})
      </h3>
      <div className="space-y-2">
        {scans.map((scan) => (
          <div
            key={scan.id}
            className="bg-white border border-[rgba(0,0,0,0.06)] p-4 flex items-center justify-between hover:bg-[#FAFAF8] transition-colors"
          >
            <button
              onClick={() => onLoad(scan)}
              className="flex-1 text-left flex items-center gap-4 min-w-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[#1A1A1A] font-medium truncate">{repoName(scan.repoUrl)}</p>
                <p className="text-xs text-[rgba(26,26,26,0.4)] mt-0.5">{fmtDate(scan.savedAt)}</p>
              </div>
              <div className="flex items-center gap-3 text-xs shrink-0">
                {scan.summary.critical > 0 && (
                  <span className="text-[#DC2626]">{scan.summary.critical} critical</span>
                )}
                {scan.summary.warning > 0 && (
                  <span className="text-[#D97706]">{scan.summary.warning} warning</span>
                )}
                {scan.summary.info > 0 && (
                  <span className="text-[#2563EB]">{scan.summary.info} info</span>
                )}
                {scan.summary.totalFlags === 0 && (
                  <span className="text-[rgba(26,26,26,0.4)]">Clean</span>
                )}
              </div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(scan.id); }}
              className="ml-4 text-[rgba(26,26,26,0.3)] hover:text-[#DC2626] text-xs transition-colors shrink-0"
              title="Delete scan"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
