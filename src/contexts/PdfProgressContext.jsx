import { createContext, useContext, useState, useCallback } from 'react';

// Shared "PDF is generating" state, used by every PDF export button across
// the app (call sheet, roster, brief, z-card, presentation) so they all show
// the same progress modal instead of each page building its own spinner.
// See src/api.js's "PDF generation job polling" for how progress data
// actually flows from the server.
const PdfProgressContext = createContext(null);

export function PdfProgressProvider({ children }) {
  // null = no PDF currently generating (modal hidden).
  const [state, setState] = useState(null);

  // label: human-readable name for what's being generated (e.g. "Roster PDF").
  // downloadFn: (onProgress) => Promise — must call onProgress(job) itself as
  // it polls (this matches the signature of api.js's job-backed PDF methods,
  // e.g. api.callSheetRosterPdfUrl(id, onProgress)).
  const runPdfDownload = useCallback(async (label, downloadFn) => {
    setState({ label, stage: 'Starting…', percent: 0 });
    try {
      await downloadFn(job => setState({ label, stage: job.stage, percent: job.percent }));
    } catch {
      // downloadFn (api.js's downloadFileWithProgress) already alerts the
      // user with the real error message — nothing more to do here besides
      // making sure the modal always closes below.
    } finally {
      setState(null);
    }
  }, []);

  return (
    <PdfProgressContext.Provider value={{ state, runPdfDownload }}>
      {children}
    </PdfProgressContext.Provider>
  );
}

// Returns a function: (label, downloadFn) => Promise<void>. Call it from any
// PDF export button's onClick to show the shared progress modal for the
// duration of that download.
export function usePdfProgress() {
  const ctx = useContext(PdfProgressContext);
  if (!ctx) throw new Error('usePdfProgress must be used within a PdfProgressProvider');
  return ctx.runPdfDownload;
}

// Internal — used only by PdfProgressModal to read the current state.
export function usePdfProgressState() {
  const ctx = useContext(PdfProgressContext);
  return ctx?.state ?? null;
}
