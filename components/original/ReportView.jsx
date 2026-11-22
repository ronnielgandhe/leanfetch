import { useState } from 'react';
import SummaryBar from './SummaryBar';
import FlagCard from './FlagCard';
import CostBreakdown from './CostBreakdown';
import SavingsSimulator from './SavingsSimulator';
import { saveScan } from './scanStore';
import { defaultAssumptions, savingsLine } from '@/lib/ui/adapter';
import { toMarkdown } from '@/lib/markdown';

export default function ReportView({ report, repoUrl, onNewScan, onSaved }) {
  const { flags, summary, tokenUsage, overallAssessment, topRecommendation, raw } = report;
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [assumptions, setAssumptions] = useState(() => defaultAssumptions(raw));
  const perInvocationSummary = savingsLine(report, assumptions);
  const noLlm = raw.stats.llmCallSites === 0;

  const handleCopy = () => {
    const verdicts = Object.fromEntries(flags.filter((f) => f.verdict).map((f) => [f.id, f.verdict]));
    const md = toMarkdown(raw, assumptions, verdicts);
    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleSave = () => {
    saveScan(repoUrl || 'unknown', report);
    setSaved(true);
    if (onSaved) onSaved();
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      {raw.errors.length > 0 && (
        <div className="bg-red-50 border border-[#DC2626]/20 p-5">
          <p className="text-[#DC2626] font-medium text-sm">Incomplete scan</p>
          <p className="text-[#DC2626]/70 text-sm mt-1">{raw.errors.length} analysis step{raw.errors.length === 1 ? '' : 's'} failed, so this report may be missing flags. Do not read it as clean. ({raw.errors.slice(0, 3).join('; ')})</p>
        </div>
      )}

      {report.deepReadError && (
        <div className="bg-amber-50 border border-[#D97706]/20 p-5">
          <p className="text-[#D97706] font-medium text-sm">Deep read did not run</p>
          <p className="text-[#D97706]/70 text-sm mt-1">{report.deepReadError} The static report below is complete without it.</p>
        </div>
      )}

      <SummaryBar summary={summary} tokenUsage={tokenUsage} deepReadModel={report.deepReadModel} />

      {overallAssessment && (
        <div className="bg-white border border-[rgba(0,0,0,0.06)] p-6">
          <h3 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-3">Overall Assessment</h3>
          <p className="text-[15px] text-[rgba(26,26,26,0.7)] leading-relaxed">{report.deepReadSummary || overallAssessment}</p>
          {report.deepReadSummary && (
            <p className="text-xs text-[rgba(26,26,26,0.4)] mt-2">Written by {report.deepReadModel} from the top flagged snippets. Static summary: {overallAssessment}</p>
          )}
          {topRecommendation && (
            <div className="mt-4 p-4 bg-[#F8F8F6] border-l-2 border-l-[#1A1A1A] border border-[rgba(0,0,0,0.06)]">
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-1">Top Recommendation</p>
              <p className="text-sm text-[#1A1A1A]">{topRecommendation}</p>
            </div>
          )}
          {perInvocationSummary && (
            <p className="text-xs text-[rgba(26,26,26,0.4)] mt-4">{perInvocationSummary}</p>
          )}
          {raw.notes.map((n) => (
            <p key={n} className="text-xs text-[rgba(26,26,26,0.4)] mt-2">{n[0].toUpperCase() + n.slice(1)}</p>
          ))}
        </div>
      )}

      {flags.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)]">
              Flags ({flags.length})
            </h3>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className={`text-[13px] font-medium px-4 py-1.5 transition-colors ${
                  saved
                    ? 'text-[rgba(26,26,26,0.4)] border border-[rgba(0,0,0,0.06)]'
                    : 'text-[rgba(26,26,26,0.5)] hover:text-[#1A1A1A] border border-[rgba(0,0,0,0.1)] hover:border-[rgba(0,0,0,0.2)]'
                }`}
              >
                {saved ? 'Saved' : 'Save Scan'}
              </button>
              <button
                onClick={handleCopy}
                className="text-[13px] font-medium text-[rgba(26,26,26,0.5)] hover:text-[#1A1A1A] border border-[rgba(0,0,0,0.1)] hover:border-[rgba(0,0,0,0.2)] px-4 py-1.5 transition-colors"
              >
                {copied ? 'Copied' : 'Copy Report'}
              </button>
              <button
                onClick={onNewScan}
                className="text-[13px] font-medium text-white bg-[#1A1A1A] hover:bg-[#333333] px-4 py-1.5 transition-colors"
              >
                New Scan
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {flags.map((flag, i) => (
              <FlagCard key={`${flag.file}-${flag.line}-${i}`} flag={flag} assumptions={assumptions} />
            ))}
          </div>
        </div>
      )}

      {flags.length === 0 && (
        <div className="bg-white border border-[rgba(0,0,0,0.06)] p-10 text-center">
          <p className="text-[rgba(26,26,26,0.7)]">{noLlm ? 'No LLM API calls were found.' : 'No API inefficiency patterns were found.'}</p>
          <p className="text-sm text-[rgba(26,26,26,0.4)] mt-1">
            {noLlm
              ? `Nothing to save here. Checked ${raw.stats.filesScanned} source files; this is an honest empty result, not a failed scan.`
              : raw.errors.length ? 'Some analysis steps failed, so this is not a clean bill of health.' : `Checked ${raw.stats.llmCallSites} LLM call sites. Your codebase looks clean!`}
          </p>
          <button
            onClick={onNewScan}
            className="mt-4 text-sm text-[#1A1A1A] hover:text-[rgba(26,26,26,0.6)] underline"
          >
            Scan another repository
          </button>
        </div>
      )}

      {flags.length > 0 && <SavingsSimulator flags={flags} assumptions={assumptions} setAssumptions={setAssumptions} />}

      <CostBreakdown tokenUsage={tokenUsage} deepReadModel={report.deepReadModel} />
    </div>
  );
}
