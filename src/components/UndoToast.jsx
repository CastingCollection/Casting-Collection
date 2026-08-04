export default function UndoToast({ pending, onUndo, onDismiss }) {
  if (!pending) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-charcoal text-white px-4 py-3 rounded-xl shadow-2xl border border-gold/30">
      <span className="text-sm">↩ {pending.label}</span>
      <button onClick={onUndo} className="bg-gold text-black font-bold px-3 py-1.5 rounded text-sm hover:bg-gold-light transition-colors">Undo</button>
      <button onClick={onDismiss} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
    </div>
  );
}
