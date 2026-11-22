'use client';

import { useState, useCallback } from 'react';
import { startScan } from './api';
import { toOldReport } from '@/lib/ui/adapter';
import { progressSteps, runDeepRead } from './scanFlow';
import { getSavedScans } from './scanStore';
import Header from './Header';
import InputPanel from './InputPanel';
import ProgressLog from './ProgressLog';
import ReportView from './ReportView';
import SavedScans from './SavedScans';
import SplashScreen from './SplashScreen';

const sentence = (m) => (m ? m[0].toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? '' : '.') : m);

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [phase, setPhase] = useState('idle');
  const [steps, setSteps] = useState([]);
  const [report, setReport] = useState(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [sourceType, setSourceType] = useState('github');
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [savedScans, setSavedScans] = useState(() => getSavedScans());
  const [inputKey, setInputKey] = useState(0);

  const refreshSaved = () => setSavedScans(getSavedScans());

  const handleSplashComplete = useCallback(() => setShowSplash(false), []);

  const handleScan = useCallback(async (config) => {
    setPhase('scanning');
    setSteps([]);
    setReport(null);
    setSourceType(config.sourceType || 'github');
    setRepoUrl(
      config.sourceType === 'plan' ? (config.planName || 'plan.md') :
      config.sourceType === 'files' ? `${config.files?.length || 0} uploaded file${(config.files?.length || 0) !== 1 ? 's' : ''}` :
      config.url
    );
    setError(null);
    setErrorCode(null);

    const push = (event) => {
      setSteps((prev) => {
        const idx = prev.findIndex((s) => s.phase === event.phase && !s.done);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = event;
          return updated;
        }
        return [...prev, event];
      });
    };

    const body = config.sourceType === 'files'
      ? { kind: 'upload', name: config.uploadName || 'upload', files: config.files.map((f) => ({ path: f.name, content: f.content })) }
      : { kind: 'github', repo: config.url };

    let finished = false;
    try {
      await startScan(body, (event) => {
        if (event.type === 'progress') {
          for (const step of progressSteps(event, config.sourceType)) push(step);
        } else if (event.type === 'report') {
          finished = true;
          push({ phase: 'triage', done: true, message: `Estimated savings for ${event.report.findings.length} flag${event.report.findings.length === 1 ? '' : 's'}` });
          const mapped = toOldReport(event.report);
          if (config.deepRead && mapped.flags.some((f) => f.finding.callKind !== 'http')) {
            runDeepRead(mapped, push).then((withDeep) => {
              setReport(withDeep);
              setPhase('complete');
            });
          } else {
            setReport(mapped);
            setPhase('complete');
          }
        } else if (event.type === 'error') {
          finished = true;
          setError(sentence(event.message));
          setErrorCode(event.code || null);
          setPhase('error');
        }
      });
      if (!finished) {
        setError('The scan stopped before it finished, so no report was produced. This is not a clean result.');
        setPhase('error');
      }
    } catch (err) {
      setError(err.name === 'AbortError' ? 'The scan timed out. No report was produced.' : sentence(err.message));
      setErrorCode(err.status === 429 ? 'rate_limited' : err.code || null);
      setPhase('error');
    }
  }, []);

  const handleReset = () => {
    setPhase('idle');
    setSteps([]);
    setReport(null);
    setRepoUrl('');
    setError(null);
    setErrorCode(null);
    setInputKey((k) => k + 1);
    refreshSaved();
  };

  const handleLoadSaved = (scan) => {
    if (!scan.report?.raw) return;
    setReport(scan.report);
    setRepoUrl(scan.repoUrl);
    setPhase('complete');
  };

  return (
    <>
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}

      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-content mx-auto w-full px-6 md:px-12 py-12">
          <InputPanel
            key={inputKey}
            onScan={handleScan}
            disabled={phase === 'scanning'}
            ready={!showSplash}
          />

          {phase === 'scanning' && (
            <div className="mt-10">
              <ProgressLog steps={steps} sourceType={sourceType} />
            </div>
          )}

          {phase === 'error' && errorCode === 'rate_limited' && (
            <div className="mt-10 bg-amber-50 border border-[#D97706]/20 p-5">
              <p className="text-[#D97706] font-medium text-sm">Rate limited</p>
              <p className="text-[#D97706]/70 text-sm mt-1">{error}</p>
              <button
                onClick={handleReset}
                className="mt-3 text-sm text-[#D97706] hover:text-[#1A1A1A] underline"
              >
                Back
              </button>
            </div>
          )}

          {phase === 'error' && errorCode !== 'rate_limited' && (
            <div className="mt-10 bg-red-50 border border-[#DC2626]/20 p-5">
              <p className="text-[#DC2626] font-medium text-sm">Scan failed</p>
              <p className="text-[#DC2626]/70 text-sm mt-1">{error}</p>
              <button
                onClick={handleReset}
                className="mt-3 text-sm text-[#DC2626] hover:text-[#1A1A1A] underline"
              >
                Try again
              </button>
            </div>
          )}

          {phase === 'complete' && report && (
            <div className="mt-10">
              <ReportView report={report} repoUrl={repoUrl} onNewScan={handleReset} onSaved={refreshSaved} />
            </div>
          )}

          {phase === 'idle' && (
            <SavedScans scans={savedScans} onLoad={handleLoadSaved} onRefresh={refreshSaved} />
          )}
        </main>
      </div>
    </>
  );
}
