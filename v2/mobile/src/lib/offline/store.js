/** expo-sqlite persistence for the outbox + a small kv table the React Query
 *  cache dehydrates into. Sync API — queue ops are cheap and this keeps the
 *  pure engine in outbox.js callable without awaiting the store.
 *  (expo-sqlite is bundled in Expo Go on SDK 57 — no dev build needed.)
 *  The pure factory + SQL live in store-core.js so node --test can exercise
 *  the real queries; this file is only the Expo wiring + photo staging. */
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { createStore } from './store-core';

export const store = createStore(SQLite.openDatabaseSync('councilog.db'));

/* ── Staged photos ──────────────────────────────────────────────────
 *  Picked image URIs (camera cache / content://) can vanish before the
 *  queue replays, so enqueuePhoto copies them under documentDirectory. */
const STAGE_DIR = `${FileSystem.documentDirectory}outbox/`;

export async function stagePhoto(uri, opId, index) {
  const ext = (uri.split('.').pop() ?? 'jpg').split('?')[0].slice(0, 5) || 'jpg';
  const dest = `${STAGE_DIR}${opId}-${index}.${ext}`;
  await FileSystem.makeDirectoryAsync(STAGE_DIR, { intermediates: true }).catch(() => {});
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

/** Remove every staged file belonging to an op (sent or discarded). */
export async function unstageOp(op) {
  try {
    const info = op.kind === 'photo_record' ? JSON.parse(op.body) : null;
    const uris = info?.photos?.map((p) => p.staged_uri).filter(Boolean) ?? [];
    await Promise.all(uris.map((u) => FileSystem.deleteAsync(u, { idempotent: true }).catch(() => {})));
  } catch { /* body unreadable — nothing to clean */ }
}

const LIVE = new Set(['pending', 'sending']);
export function isLive(status) { return LIVE.has(status); }
