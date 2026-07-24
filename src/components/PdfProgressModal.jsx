import { usePdfProgressState } from '../contexts/PdfProgressContext.jsx';

// Rendered once at the app root (see App.jsx). Shows a real step-by-step
// progress bar while any PDF export is generating server-side — see
// PdfProgressContext.jsx and src/api.js's job-polling helpers for how the
// stage/percent values actually get here.
export default function PdfProgressModal() {
  const state = usePdfProgressState();
  if (!state) return null;
  const { label, stage, percent } = state;
  const pct = Math.min(100, Math.max(0, Math.round(percent || 0)));

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-80">
        <div className="text-sm font-bold text-charcoal mb-1">{label}</div>
        <div className="text-xs text-gray-500 mb-4 min-h-[1em]">{stage}</div>
        <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-gold transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-right text-xs text-gray-400 mt-1.5">{pct}%</div>
      </div>
    </div>
  );
}
