'use client';

import { useState, useRef, useEffect } from 'react';
import { unzipSync } from 'fflate';
import { SAMPLE_FILES } from '@/lib/ui/sample';

const EXAMPLES = ['yoheinakajima/babyagi', 'mckaywrigley/chatbot-ui', 'sindresorhus/slugify'];
const SOURCE_EXT = /\.(m|c)?(j|t)sx?$|\.py$/;

/* ── Deep read tooltip ── */
const DeepReadTooltip = ({ text }) => (
  <span className="tooltip-trigger relative inline-flex align-middle ml-1 cursor-help">
    <span className="grid place-items-center w-4 h-4 rounded-full border border-[rgba(26,26,26,0.3)] text-[rgba(26,26,26,0.3)] text-[10px] leading-none transition-colors hover:border-[rgba(26,26,26,0.5)] hover:text-[rgba(26,26,26,0.5)]" style={{ paddingLeft: '1.5px' }}>?</span>
    <span className="tooltip-content absolute bottom-full left-0 mb-2 w-56 bg-[#1A1A1A] text-white text-[11px] leading-relaxed rounded px-3 py-2.5 z-50 font-normal normal-case tracking-normal whitespace-normal">
      {text}
      <span className="absolute top-full left-2 border-4 border-transparent border-t-[#1A1A1A]"></span>
    </span>
  </span>
);

/* ── Tab labels (match the card labels exactly) ── */
const TABS = [
  { id: 'github', label: 'GitHub Repo' },
  { id: 'files', label: 'Direct Files Upload' },
  { id: 'plan', label: 'Plan Analysis' },
];

/* ── Source cards ── */
const SOURCE_CARDS = [
  {
    id: 'github',
    label: 'GitHub Repo',
    description: 'Scan a public repository',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    ),
  },
  {
    id: 'files',
    label: 'Direct Files Upload',
    description: 'Upload source files for analysis',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    id: 'plan',
    label: 'Plan Analysis',
    description: 'Analyze architecture and design documents',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
];

/* ================================================================ */

export default function InputPanel({ onScan, disabled, ready }) {
  /* ── View state ── */
  const [view, setView] = useState('cards');   // 'cards' | 'transitioning' | 'panel'
  const [inputMode, setInputMode] = useState('github');
  const [titleShown, setTitleShown] = useState(false);
  const [shownCards, setShownCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);

  /* ── Form state ── */
  const [url, setUrl] = useState('');
  const [deepRead, setDeepRead] = useState(null);
  const [fileError, setFileError] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [planText, setPlanText] = useState('');
  const [planName, setPlanName] = useState('');
  const [planFile, setPlanFile] = useState(null);

  /* ── Refs ── */
  const fileInputRef = useRef(null);
  const planFileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/deep-read')
      .then((r) => r.json())
      .then((d) => alive && setDeepRead(d))
      .catch(() => alive && setDeepRead({ enabled: false }));
    return () => { alive = false; };
  }, []);

  const deepOn = !!deepRead?.enabled;
  const deepText = deepOn
    ? `Scan + Deep Read sends only the top ${deepRead.maxFindings || 10} flagged snippets (capped) to Claude on our server to confirm or reject each flag and write the assessment. ${deepRead.perIpPerDay} per day.`
    : 'Deep read uses Claude on the server to double check the top flags. It is off on this deploy; the static scan is complete without it.';

  /* ── Staggered card entrance ── */
  useEffect(() => {
    if (!ready) return;
    const t0 = setTimeout(() => setTitleShown(true), 50);
    const cardTimers = SOURCE_CARDS.map((card, i) =>
      setTimeout(() => setShownCards((prev) => [...prev, card.id]), 150 + i * 120)
    );
    return () => { clearTimeout(t0); cardTimers.forEach(clearTimeout); };
  }, [ready]);

  /* ── Card click → exit cards, enter panel ── */
  const handleCardClick = (id) => {
    if (selectedCard) return;
    setSelectedCard(id);
    setInputMode(id);
    setView('transitioning');
    setTimeout(() => setView('panel'), 300);
  };

  /* ── Build scan config ── */
  const buildConfig = (withDeepRead) => {
    if (inputMode === 'github') {
      return { sourceType: 'github', url: url.trim(), deepRead: withDeepRead };
    } else if (inputMode === 'files') {
      return { sourceType: 'files', files: uploadedFiles, uploadName: uploadedFiles.length === 1 ? uploadedFiles[0].name : `${uploadedFiles.length} files`, deepRead: withDeepRead };
    }
    return { sourceType: 'plan', planName: planName || 'plan.md', planText };
  };

  const canScan = () => {
    if (inputMode === 'github') return !!url.trim();
    if (inputMode === 'files') return uploadedFiles.length > 0;
    return false;
  };

  const runDemo = () => {
    if (inputMode === 'github') {
      setUrl(EXAMPLES[0]);
      onScan({ sourceType: 'github', url: EXAMPLES[0], deepRead: false });
    } else if (inputMode === 'files') {
      setUploadedFiles(SAMPLE_FILES);
      onScan({ sourceType: 'files', files: SAMPLE_FILES, uploadName: 'demo files', deepRead: false });
    }
  };

  /* ── File handlers ── */
  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    setFileError('');
    for (const file of files) {
      if (/\.zip$/i.test(file.name)) {
        try {
          const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
            filter: (z) => SOURCE_EXT.test(z.name) && !/(^|\/)(node_modules|dist|build|vendor|\.next)\//.test(z.name) && z.originalSize <= 300 * 1024,
          });
          const decoder = new TextDecoder();
          const added = Object.entries(entries).map(([name, data]) => ({ name, content: decoder.decode(data) }));
          if (!added.length) setFileError(`${file.name} has no .js, .ts or .py files`);
          setUploadedFiles((prev) => [...prev, ...added]);
        } catch {
          setFileError(`Could not read ${file.name}`);
        }
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setUploadedFiles((prev) => [...prev, { name: file.name, content: reader.result }]);
      };
      reader.readAsText(file);
    }
  };

  const handlePlanUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPlanText(reader.result);
      setPlanFile(null);
      setPlanName(file.name);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const removeFile = (index) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  /* ── Shared classes ── */
  const inputClass =
    'w-full bg-white border border-[rgba(0,0,0,0.1)] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[rgba(26,26,26,0.3)] focus:outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A] disabled:opacity-50';

  const tabClass = (id) =>
    `px-5 py-2.5 text-[13px] font-medium transition-colors ${
      inputMode === id
        ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A]'
        : 'text-[rgba(26,26,26,0.4)] hover:text-[rgba(26,26,26,0.7)] border-b-2 border-transparent'
    }`;

  const labelClass =
    'block text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-2';

  /* ================================================================
     CARDS VIEW  +  TRANSITIONING (exit animation)
     ================================================================ */
  if (view === 'cards' || view === 'transitioning') {
    return (
      <div className={`py-8 md:py-14 ${view === 'transitioning' ? 'cards-exiting' : ''}`}>
        <h2
          className={`audit-title text-center text-2xl md:text-[1.75rem] font-light tracking-tight text-[#1A1A1A] mb-10 ${
            titleShown ? 'is-shown' : ''
          }`}
        >
          What would you like to audit?
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {SOURCE_CARDS.map((card) => {
            const isSelected = view === 'transitioning' && selectedCard === card.id;
            const isOther = view === 'transitioning' && selectedCard !== card.id;

            return (
              <button
                key={card.id}
                type="button"
                onClick={() => handleCardClick(card.id)}
                disabled={view === 'transitioning'}
                className={`group text-left border bg-white p-7 cursor-pointer
                  transition-all duration-500
                  ${shownCards.includes(card.id) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}
                  ${!selectedCard ? 'border-[rgba(0,0,0,0.08)] hover:border-[rgba(0,0,0,0.25)] hover:shadow-sm' : ''}
                  ${isSelected ? 'border-[rgba(0,0,0,0.3)] !duration-150' : ''}
                  ${isOther ? '!opacity-50 !duration-150' : ''}
                `}
                style={{
                  transform: isSelected ? 'scale(1.03)' : isOther ? 'scale(0.97)' : undefined,
                  transition: view === 'transitioning' ? 'transform 0.15s ease, opacity 0.15s ease' : undefined,
                }}
              >
                {/* Fixed-height icon container: aligns all icons on the same baseline */}
                <div className="h-7 flex items-center text-[rgba(26,26,26,0.35)] group-hover:text-[#1A1A1A] transition-colors duration-200 mb-4">
                  {card.icon}
                </div>
                <h3 className="text-[15px] font-medium text-[#1A1A1A] mb-1.5">
                  {card.label}
                </h3>
                <p className="text-[13px] text-[rgba(26,26,26,0.45)] leading-relaxed">
                  {card.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  /* ================================================================
     PANEL VIEW: expanded form (grows in from cards)
     ================================================================ */
  return (
    <div className="panel-grow-enter bg-white border border-[rgba(0,0,0,0.06)]">
      {/* ── Centered tab bar ── */}
      <div className="flex justify-center border-b border-[rgba(0,0,0,0.06)] pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setInputMode(tab.id)}
            disabled={disabled}
            className={tabClass(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-6 md:p-8">
        {/* ── GITHUB MODE ── */}
        {inputMode === 'github' && (
          <>
            <div>
              <label className={labelClass}>
                GitHub Repository URL <span className="text-[#DC2626]">*</span>
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo or owner/repo"
                disabled={disabled}
                className={inputClass}
              />
            </div>
            <div className="mt-5">
              <label className={labelClass}>
                Example Repos{' '}
                <span className="text-[rgba(26,26,26,0.3)] normal-case tracking-normal">(one click)</span>
              </label>
              <div className="flex gap-2 flex-wrap">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => { setUrl(ex); onScan({ sourceType: 'github', url: ex, deepRead: false }); }} disabled={disabled} className="border border-[rgba(0,0,0,0.1)] text-[13px] px-4 py-2 hover:bg-[#FAFAF8] transition-colors disabled:opacity-50">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── FILES MODE ── */}
        {inputMode === 'files' && (
          <>
            <div>
              <label className={labelClass}>Source Files <span className="text-[#DC2626]">*</span></label>
              <div className="flex gap-2 mb-3">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled} className="border border-[rgba(0,0,0,0.1)] text-[13px] px-4 py-2 hover:bg-[#FAFAF8] transition-colors disabled:opacity-50">
                  Choose Files
                </button>
                <input ref={fileInputRef} type="file" multiple accept=".js,.jsx,.ts,.tsx,.py,.mjs,.cjs,.zip" onChange={handleFileUpload} className="hidden" />
                <span className="text-xs text-[rgba(26,26,26,0.4)] self-center">
                  {uploadedFiles.length > 0 ? `${uploadedFiles.length} file${uploadedFiles.length !== 1 ? 's' : ''} added` : 'No files selected'}
                </span>
                {fileError && <span className="text-xs text-[#DC2626] self-center">{fileError}</span>}
              </div>
              {uploadedFiles.length > 0 && (
                <div className="border border-[rgba(0,0,0,0.06)] divide-y divide-[rgba(0,0,0,0.06)] mb-3 max-h-40 overflow-y-auto">
                  {uploadedFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="font-mono text-[#1A1A1A]">{f.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[rgba(26,26,26,0.3)]">{(f.content.length / 1024).toFixed(1)} KB</span>
                        <button type="button" onClick={() => removeFile(i)} className="text-[rgba(26,26,26,0.3)] hover:text-[#DC2626]">&times;</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}


        {/* ── PLAN MODE ── */}
        {inputMode === 'plan' && (
          <>
            <div>
              <label className={labelClass}>Architecture / Design Plan <span className="text-[#DC2626]">*</span></label>
              <input ref={planFileRef} type="file" accept=".md,.txt,.markdown" onChange={handlePlanUpload} className="hidden" />
              {planFile || (planName && planName !== 'plan.md') ? (
                <div className="border-2 border-dashed border-[rgba(0,0,0,0.1)] p-6 text-center">
                  <div className="text-sm text-[#1A1A1A] font-medium">{planName}</div>
                  <div className="text-xs text-[rgba(26,26,26,0.4)] mt-1">{`${planText.length} characters`}</div>
                  <button type="button" onClick={() => { setPlanText(''); setPlanFile(null); setPlanName(''); }} className="text-xs text-[#DC2626] hover:text-[#1A1A1A] mt-2 underline">Remove and start over</button>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed border-[rgba(0,0,0,0.1)] hover:border-[rgba(0,0,0,0.25)] transition-colors cursor-pointer"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-[#1A1A1A]', 'bg-[#FAFAF8]'); }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove('border-[#1A1A1A]', 'bg-[#FAFAF8]'); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('border-[#1A1A1A]', 'bg-[#FAFAF8]');
                    const file = e.dataTransfer.files[0];
                    if (file) { const dt = new DataTransfer(); dt.items.add(file); planFileRef.current.files = dt.files; planFileRef.current.dispatchEvent(new Event('change', { bubbles: true })); }
                  }}
                  onClick={() => planFileRef.current?.click()}
                >
                  <div className="p-4 text-center pointer-events-none">
                    <div className="text-[rgba(26,26,26,0.3)] text-2xl mb-1">+</div>
                    <div className="text-xs text-[rgba(26,26,26,0.4)]">Drop a file here or click to upload</div>
                    <div className="text-[10px] text-[rgba(26,26,26,0.3)] mt-1">.txt, .md</div>
                  </div>
                </div>
              )}
              <textarea
                value={planFile ? '' : planText}
                onChange={(e) => { setPlanText(e.target.value); setPlanFile(null); setPlanName(planName || ''); }}
                placeholder="Or paste your plan text here..."
                disabled={disabled || !!planFile}
                rows={6}
                className={`${inputClass} resize-y font-mono text-xs mt-3 ${planFile ? 'opacity-40' : ''}`}
              />
            </div>
          </>
        )}

        {/* ── Scan buttons ── */}
        <div className="mt-6 flex items-center justify-between">
          <p className="text-xs text-[rgba(26,26,26,0.4)]">
            {inputMode === 'github' ? 'Public repos only. Fetched, analyzed in-memory and not stored.' :
             inputMode === 'files' ? 'Files are analyzed in-memory and not stored.' :
             'Plan analysis needs a server-side Claude pass and is not available on this deploy yet.'}
            <DeepReadTooltip text={inputMode === 'plan' ? 'The code scan is static and free. Reading a design doc needs a model, so this tab stays off until a server-side plan route is added.' : deepText} />
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={disabled || inputMode === 'plan'} onClick={runDemo} className="text-[13px] font-medium text-[rgba(26,26,26,0.5)] hover:text-[#1A1A1A] px-4 py-2.5 transition-colors disabled:text-[rgba(26,26,26,0.2)]">
              Demo {inputMode === 'plan' ? 'Analysis' : 'Scan'}
            </button>
            <button type="button" disabled={disabled || !deepOn || !canScan()} onClick={() => onScan(buildConfig(true))} className="border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white text-[13px] font-medium px-5 py-2.5 transition-colors disabled:border-[rgba(0,0,0,0.1)] disabled:text-[rgba(26,26,26,0.3)] disabled:hover:bg-transparent disabled:hover:text-[rgba(26,26,26,0.3)]">
              {disabled ? 'Scanning...' : inputMode === 'plan' ? 'Analyze + Deep Read' : 'Scan + Deep Read'}
            </button>
            <button type="button" disabled={disabled || !canScan()} onClick={() => onScan(buildConfig(false))} className="bg-[#1A1A1A] hover:bg-[#333333] text-white text-[13px] font-medium px-5 py-2.5 transition-colors disabled:bg-[rgba(26,26,26,0.15)] disabled:text-[rgba(26,26,26,0.3)]">
              {disabled ? 'Scanning...' : inputMode === 'plan' ? 'Analyze' : 'Scan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
