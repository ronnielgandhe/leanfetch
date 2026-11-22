const STORAGE_KEY = 'leanfetch_saved_scans';

export function getSavedScans() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveScan(repoUrl, report) {
  const scans = getSavedScans();
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    repoUrl,
    savedAt: new Date().toISOString(),
    summary: report.summary,
    overallAssessment: report.overallAssessment,
    topRecommendation: report.topRecommendation,
    report,
  };
  scans.unshift(entry);
  // Keep max 50 saved scans
  if (scans.length > 50) scans.length = 50;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scans));
  return entry;
}

export function deleteScan(id) {
  const scans = getSavedScans().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scans));
}
