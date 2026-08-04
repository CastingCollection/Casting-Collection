import { useState, useRef } from 'react';

const UNDO_TTL = 8000;

export function useUndo() {
  const [pending, setPending] = useState(null); // { label, fn }
  const timerRef = useRef(null);

  const pushUndo = (label, fn) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPending({ label, fn });
    timerRef.current = setTimeout(() => setPending(null), UNDO_TTL);
  };

  const executeUndo = async () => {
    if (!pending) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const fn = pending.fn;
    setPending(null);
    await fn();
  };

  const dismissUndo = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPending(null);
  };

  return { pushUndo, undoPending: pending, executeUndo, dismissUndo };
}
