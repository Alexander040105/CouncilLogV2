import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';

const ToastCtx = createContext(null);

let seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind, msg) => {
    const id = ++seq;
    setToasts((ts) => [...ts.slice(-3), { id, kind, msg }]);
    timers.current[id] = setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const toast = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div
        role="status" aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-20 z-[60] flex flex-col items-center gap-2 md:inset-x-auto md:right-6 md:bottom-6 md:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-3)] px-3 py-2 text-sm shadow-lg md:w-auto"
          >
            {t.kind === 'success'
              ? <CheckCircle2 size={16} className="shrink-0 text-[var(--color-status-done)]" />
              : <XCircle size={16} className="shrink-0 text-[var(--color-status-alert)]" />}
            <span className="flex-1">{t.msg}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss"
                    className="min-h-[28px] min-w-[28px] text-[var(--color-ink-3)]">
              <X size={14} className="mx-auto" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
