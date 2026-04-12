import { useState, useRef } from 'react';

const TABS = [
  { id: 'github', label: 'GitHub Repo' },
  { id: 'files', label: 'Upload Files' },
  { id: 'plan', label: 'Analyze Plan' },
];

export default function InputPanel({ onScan, disabled }) {
  const [inputMode, setInputMode] = useState('github');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [githubPat, setGithubPat] = useState('');
  const [url, setUrl] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [planText, setPlanText] = useState('');
  const [planName, setPlanName] = useState('');
  const fileInputRef = useRef(null);
  const planFileRef = useRef(null);

  const buildConfig = (keyOverride) => {
    const key = keyOverride || anthropicKey.trim();
    if (inputMode === 'github') {
      return { sourceType: 'github', url: url.trim(), anthropicKey: key, githubPat: githubPat.trim() || undefined };
    } else if (inputMode === 'files') {
      return { sourceType: 'files', files: uploadedFiles, anthropicKey: key };
    } else {
      const config = { sourceType: 'plan', planName: planName || 'plan.md', anthropicKey: key };
      if (planFile) {
        config.planFile = planFile; // base64 for PDF/DOCX
      } else {
        config.planText = planText; // plain text
      }
      return config;
    }
  };

  const canScan = () => {
    if (inputMode === 'github') return !!url.trim();
    if (inputMode === 'files') return uploadedFiles.length > 0;
    if (inputMode === 'plan') return !!planText.trim();
    return false;
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        setUploadedFiles((prev) => [...prev, { name: file.name, content: reader.result }]);
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const [planFile, setPlanFile] = useState(null); // base64 for PDF/DOCX

  const handlePlanUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();

    if (ext === 'pdf' || ext === 'docx' || ext === 'doc') {
      // Binary format — read as base64, send to server for extraction
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1]; // strip data:... prefix
        setPlanFile(base64);
        setPlanText(`[${file.name} uploaded — text will be extracted server-side]`);
        setPlanName(file.name);
      };
      reader.readAsDataURL(file);
    } else {
      // Plain text format — read directly
      const reader = new FileReader();
      reader.onload = () => {
        setPlanText(reader.result);
        setPlanFile(null);
        setPlanName(file.name);
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const removeFile = (index) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const inputClass =
    'w-full bg-white border border-[rgba(0,0,0,0.1)] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder-[rgba(26,26,26,0.3)] focus:outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A] disabled:opacity-50';

  const tabClass = (id) =>
    `px-4 py-2 text-[13px] font-medium transition-colors ${
      inputMode === id
        ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A]'
        : 'text-[rgba(26,26,26,0.4)] hover:text-[rgba(26,26,26,0.7)] border-b-2 border-transparent'
    }`;

  return (
    <div className="bg-white border border-[rgba(0,0,0,0.06)]">
      {/* Tab bar */}
      <div className="flex border-b border-[rgba(0,0,0,0.06)] px-6 pt-2">
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
        {/* API Key (shown for all modes) */}
        <div className={inputMode === 'github' ? 'grid gap-5 md:grid-cols-2' : ''}>
          <div>
            <label className="block text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-2">
              Anthropic API Key
            </label>
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-... (optional for Subscription mode)"
              disabled={disabled}
              className={inputClass}
            />
          </div>
          {inputMode === 'github' && (
            <div>
              <label className="block text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-2">
                GitHub PAT <span className="text-[rgba(26,26,26,0.3)] normal-case tracking-normal">(optional, for private repos)</span>
              </label>
              <input
                type="password"
                value={githubPat}
                onChange={(e) => setGithubPat(e.target.value)}
                placeholder="ghp_..."
                disabled={disabled}
                className={inputClass}
              />
            </div>
          )}
        </div>

        {/* GitHub mode */}
        {inputMode === 'github' && (
          <div className="mt-5">
            <label className="block text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-2">
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
        )}

        {/* File upload mode */}
        {inputMode === 'files' && (
          <div className="mt-5">
            <label className="block text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-2">
              Source Files <span className="text-[#DC2626]">*</span>
            </label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                className="border border-[rgba(0,0,0,0.1)] text-[13px] px-4 py-2 hover:bg-[#FAFAF8] transition-colors disabled:opacity-50"
              >
                Choose Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.rb,.php,.vue,.svelte,.kt,.scala,.swift,.cs,.mjs,.cjs"
                onChange={handleFileUpload}
                className="hidden"
              />
              <span className="text-xs text-[rgba(26,26,26,0.4)] self-center">
                {uploadedFiles.length > 0 ? `${uploadedFiles.length} file${uploadedFiles.length !== 1 ? 's' : ''} added` : 'No files selected'}
              </span>
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
        )}

        {/* Plan analysis mode */}
        {inputMode === 'plan' && (
          <div className="mt-5">
            <label className="block text-[13px] font-medium uppercase tracking-[0.08em] text-[rgba(26,26,26,0.4)] mb-2">
              Architecture / Design Plan <span className="text-[#DC2626]">*</span>
            </label>
            <input
              ref={planFileRef}
              type="file"
              accept=".md,.txt,.markdown,.pdf,.docx,.doc"
              onChange={handlePlanUpload}
              className="hidden"
            />

            {/* Show uploaded file info OR the paste area */}
            {planFile || (planName && planName !== 'plan.md') ? (
              <div className="border-2 border-dashed border-[rgba(0,0,0,0.1)] p-6 text-center">
                <div className="text-sm text-[#1A1A1A] font-medium">{planName}</div>
                <div className="text-xs text-[rgba(26,26,26,0.4)] mt-1">
                  {planFile ? 'File uploaded — text will be extracted' : `${planText.length} characters`}
                </div>
                <button
                  type="button"
                  onClick={() => { setPlanText(''); setPlanFile(null); setPlanName(''); }}
                  className="text-xs text-[#DC2626] hover:text-[#1A1A1A] mt-2 underline"
                >
                  Remove and start over
                </button>
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
                  if (file) {
                    // Simulate file input change
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    planFileRef.current.files = dt.files;
                    planFileRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }}
                onClick={() => planFileRef.current?.click()}
              >
                <div className="p-4 text-center pointer-events-none">
                  <div className="text-[rgba(26,26,26,0.3)] text-2xl mb-1">+</div>
                  <div className="text-xs text-[rgba(26,26,26,0.4)]">
                    Drop a file here or click to upload
                  </div>
                  <div className="text-[10px] text-[rgba(26,26,26,0.3)] mt-1">
                    .txt, .md, .pdf, .docx
                  </div>
                </div>
              </div>
            )}

            {/* Always show textarea for pasting */}
            <textarea
              value={planFile ? '' : planText}
              onChange={(e) => { setPlanText(e.target.value); setPlanFile(null); setPlanName(planName || ''); }}
              placeholder="Or paste your plan text here..."
              disabled={disabled || !!planFile}
              rows={6}
              className={`${inputClass} resize-y font-mono text-xs mt-3 ${planFile ? 'opacity-40' : ''}`}
            />
          </div>
        )}

        {/* Scan buttons */}
        <div className="mt-6 flex items-center justify-between">
          <p className="text-xs text-[rgba(26,26,26,0.4)]">
            {inputMode === 'github' ? 'Keys are not stored and exist only for the duration of your scan.' :
             inputMode === 'files' ? 'Files are analyzed in-memory and not stored.' :
             'Plans are analyzed in-memory and not stored.'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled || !canScan()}
              onClick={() => onScan(buildConfig('demo'))}
              className="text-[13px] font-medium text-[rgba(26,26,26,0.5)] hover:text-[#1A1A1A] px-4 py-2.5 transition-colors disabled:text-[rgba(26,26,26,0.2)]"
            >
              Demo {inputMode === 'plan' ? 'Analysis' : 'Scan'}
            </button>
            <button
              type="button"
              disabled={disabled || !canScan()}
              onClick={() => onScan(buildConfig('cli'))}
              className="border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white text-[13px] font-medium px-5 py-2.5 transition-colors disabled:border-[rgba(0,0,0,0.1)] disabled:text-[rgba(26,26,26,0.3)] disabled:hover:bg-transparent disabled:hover:text-[rgba(26,26,26,0.3)]"
            >
              {disabled ? 'Scanning...' : inputMode === 'plan' ? 'Analyze via Subscription' : 'Scan via Subscription'}
            </button>
            <button
              type="button"
              disabled={disabled || !anthropicKey.trim() || !canScan()}
              onClick={() => onScan(buildConfig())}
              className="bg-[#1A1A1A] hover:bg-[#333333] text-white text-[13px] font-medium px-5 py-2.5 transition-colors disabled:bg-[rgba(26,26,26,0.15)] disabled:text-[rgba(26,26,26,0.3)]"
            >
              {disabled ? 'Scanning...' : inputMode === 'plan' ? 'Analyze (API Key)' : 'Scan (API Key)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
