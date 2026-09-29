/** expo-sqlite persistence for the outbox + a small kv table the React Query
 *  cache dehydrates into. Sync API — queue ops are cheap and this keeps the
 *  pure engine in outbox.js callable without awaiting the store.
 *  (expo-sqlite is bundled in Expo Go on SDK 57 — no dev build needed.) */
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';

const db = SQLite.openDatabaseSync('councilog.db');

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id TEXT UNIQUE NOT NULL,
    org_id TEXT,
    kind TEXT NOT NULL DEFAULT 'http',
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    body TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    result_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS outbox_status ON outbox(status, seq);
  CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT,
    updated_at TEXT
  );
`);

const PENDING = new Set(['pending', 'sending']);

export const store = {
  insert(op) {
    db.runSync(
      `INSERT INTO outbox (op_id, org_id, kind, method, path, body, status, error, result_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [op.op_id, op.org_id, op.kind, op.method, op.path, op.body, op.status, op.error, op.result_id, op.created_at],
    );
  },
  pending() {
    return db.getAllSync(
      `SELECT * FROM outbox WHERE status IN ('pending','sending') ORDER BY seq`,
    );
  },
  sent() {
    return db.getAllSync(`SELECT * FROM outbox WHERE status = 'sent' ORDER BY seq`);
  },
  all() {
    return db.getAllSync(`SELECT * FROM outbox ORDER BY seq`);
  },
  get(opId) {
    return db.getFirstSync(`SELECT * FROM outbox WHERE op_id = ?`, [opId]);
  },
  update(opId, patch) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    db.runSync(
      `UPDATE outbox SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE op_id = ?`,
      [...keys.map((k) => patch[k]), opId],
    );
  },
  remove(opId) {
    db.runSync(`DELETE FROM outbox WHERE op_id = ?`, [opId]);
  },
  /** Any live (unsent) op still referencing `op:<depId>` in path or body. */
  references(depId) {
    const rows = db.getAllSync(
      `SELECT op_id FROM outbox WHERE status IN ('pending','sending') AND (path LIKE ? OR body LIKE ?)`,
      [`%op:${depId}%`, `%op:${depId}%`],
    );
    return rows.length > 0;
  },
  counts() {
    const rows = db.getAllSync(`SELECT status, COUNT(*) AS n FROM outbox GROUP BY status`);
    const out = { pending: 0, sending: 0, sent: 0, dead: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  },
  kvGet(k) {
    return db.getFirstSync(`SELECT v FROM kv WHERE k = ?`, [k])?.v ?? null;
  },
  kvSet(k, v) {
    db.runSync(
      `INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
      [k, v, new Date().toISOString()],
    );
  },
};

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

export function isLive(status) { return PENDING.has(status); }
