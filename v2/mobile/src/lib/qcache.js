/** React Query read-cache persistence: dehydrate the cache into the SQLite
 *  kv table on every write (debounced), hydrate it on cold start — lists stay
 *  readable fully offline without a second copy of the data layer. */
import { dehydrate, hydrate } from '@tanstack/react-query';
import { store } from './offline/store';

const KEY = 'rq-cache';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // one day — roster/journal go stale fast

export function hydrateQueryCache(qc) {
  const raw = store.kvGet(KEY);
  if (!raw) return;
  try {
    const { state, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > MAX_AGE_MS) return;
    hydrate(qc, state);
  } catch { /* corrupt row — start empty */ }
}

export function persistQueryCache(qc) {
  let timer = null;
  const flush = () => {
    timer = null;
    try {
      const state = dehydrate(qc, {
        shouldDehydrateQuery: (q) => q.state.status === 'success',
      });
      store.kvSet(KEY, JSON.stringify({ state, savedAt: Date.now() }));
    } catch { /* dehydrate of a fat cache can throw — skip this write */ }
  };
  return qc.getQueryCache().subscribe(() => {
    if (!timer) timer = setTimeout(flush, 500);
  });
}
