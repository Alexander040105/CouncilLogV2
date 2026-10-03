/** "New version ready" banner — the service worker downloads updates in the
 *  background and ASKS before reloading, so an update never swaps the page
 *  out from under someone's half-typed journal entry.
 *
 *  When updates.json carries notes for the release, they show under the
 *  title so the reload has context. Web always prompts — unlike mobile's
 *  'minor' level, Workbox prompt mode can't apply a waiting SW silently. */
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { RefreshCw, X } from 'lucide-react';

const MAX_NOTES = 4;
let updateSW = null;

async function fetchNotes() {
  try {
    const r = await fetch('/updates.json', { cache: 'no-store' });
    if (!r.ok) return [];
    const data = await r.json();
    const notes = data?.updates?.[0]?.notes;
    return Array.isArray(notes) ? notes : [];
  } catch { return []; }
}

export function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  const [notes, setNotes] = useState([]);
  useEffect(() => {
    updateSW = registerSW({
      onNeedRefresh: async () => {
        setNotes(await fetchNotes());
        setReady(true);
      },
    });
  }, []);

  if (!ready) return null;
  const shown = notes.slice(0, MAX_NOTES);
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-[70] mx-auto max-w-sm rounded-[var(--radius-card)] [border:var(--border-box)] bg-[var(--color-surface-3)] px-3 py-2 text-sm [box-shadow:var(--shadow-1)] md:right-6 md:left-auto md:mx-0"
    >
      <div className="flex items-center gap-2">
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
      {shown.length > 0 && (
        <ul className="mt-1 ml-[23px] list-disc space-y-0.5 text-xs text-[var(--color-ink-2)]">
          {shown.map((n, i) => <li key={i}>{n}</li>)}
          {notes.length > MAX_NOTES && <li>+{notes.length - MAX_NOTES} more</li>}
        </ul>
      )}
    </div>
  );
}
