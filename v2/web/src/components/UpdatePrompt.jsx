/** "New version ready" banner — the service worker downloads updates in the
 *  background and ASKS before reloading, so an update never swaps the page
 *  out from under someone's half-typed journal entry. */
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { RefreshCw, X } from 'lucide-react';

let updateSW = null;

export function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    updateSW = registerSW({ onNeedRefresh: () => setReady(true) });
  }, []);

  if (!ready) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-[70] mx-auto flex max-w-sm items-center gap-2 rounded-[var(--radius-card)] [border:var(--border-box)] bg-[var(--color-surface-3)] px-3 py-2 text-sm [box-shadow:var(--shadow-1)] md:right-6 md:left-auto md:mx-0"
    >
      <RefreshCw size={15} className="shrink-0 text-[var(--color-brand)]" />
      <span className="flex-1">A new version of CounciLog is ready.</span>
      <button
        onClick={() => updateSW?.(true)}
        className="min-h-[36px] rounded-[var(--radius-input)] bg-[var(--color-accent)] px-3 font-bold text-[var(--color-accent-fg)]"
      >
        Reload
      </button>
      <button
        onClick={() => setReady(false)}
        aria-label="Update later"
        className="flex min-h-[36px] min-w-[36px] items-center justify-center text-[var(--color-ink-3)]"
      >
        <X size={15} />
      </button>
    </div>
  );
}
