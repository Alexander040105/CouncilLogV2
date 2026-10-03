/** Pure outbox store — no Expo imports. createStore(db) works over any
 *  object with the expo-sqlite sync surface (execSync/runSync/getAllSync/
 *  getFirstSync), so `node --test` can drive it with node:sqlite (see
 *  store.test.js). store.js wires it to the real device database. */

const SCHEMA = `
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
`;

export function createStore(db) {
  db.execSync(SCHEMA);
  return {
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
}
