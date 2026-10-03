/** node --test — real-SQL coverage for the outbox store. createStore() only
 *  needs the expo-sqlite sync surface, so node:sqlite's DatabaseSync stands
 *  in: same schema, same queries, actual ORDER BY / LIKE / upsert behavior.
 *  This catches what a hand-rolled array stub can't — broken SQL, wrong
 *  column names, LIKE-escaping surprises, dup op_id inserts. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from './store-core.js';

/** Adapt node:sqlite to the expo-sqlite sync surface createStore expects. */
function sqliteDb() {
  const d = new DatabaseSync(':memory:');
  return {
    execSync: (sql) => d.exec(sql),
    runSync: (sql, params = []) => d.prepare(sql).run(...params),
    getAllSync: (sql, params = []) => d.prepare(sql).all(...params),
    getFirstSync: (sql, params = []) => d.prepare(sql).get(...params) ?? null,
  };
}

const op = (over = {}) => ({
  op_id: `op-${Math.random().toString(36).slice(2, 10)}`,
  org_id: 'o1', kind: 'http', method: 'POST', path: '/x',
  body: '{}', status: 'pending', error: null, result_id: null,
  created_at: new Date().toISOString(),
  ...over,
});

describe('createStore (real SQL)', () => {
  it('inserts and reads back all columns; pending() is FIFO by seq', () => {
    const s = createStore(sqliteDb());
    const a = op({ path: '/a' }), b = op({ path: '/b' });
    s.insert(a); s.insert(b);
    assert.equal(s.get(a.op_id).path, '/a');
    assert.equal(s.get(a.op_id).kind, 'http');
    assert.deepEqual(s.pending().map((r) => r.path), ['/a', '/b']);
    assert.equal(s.all().length, 2);
  });

  it('rejects a duplicate op_id (UNIQUE constraint)', () => {
    const s = createStore(sqliteDb());
    const a = op();
    s.insert(a);
    assert.throws(() => s.insert({ ...a, path: '/other' }));
  });

  it('pending() excludes sent and dead', () => {
    const s = createStore(sqliteDb());
    const a = op(), b = op(), c = op();
    s.insert(a); s.insert(b); s.insert(c);
    s.update(b.op_id, { status: 'sent' });
    s.update(c.op_id, { status: 'dead' });
    assert.deepEqual(s.pending().map((r) => r.op_id), [a.op_id]);
    assert.deepEqual(s.sent().map((r) => r.op_id), [b.op_id]);
  });

  it('update() patches only the named fields; empty patch is a no-op', () => {
    const s = createStore(sqliteDb());
    const a = op({ error: null });
    s.insert(a);
    s.update(a.op_id, { status: 'dead', error: 'nope' });
    const row = s.get(a.op_id);
    assert.equal(row.status, 'dead');
    assert.equal(row.error, 'nope');
    assert.equal(row.path, '/x');           // untouched
    s.update(a.op_id, {});                  // must not throw
    assert.equal(s.get(a.op_id).status, 'dead');
  });

  it('remove() deletes by op_id', () => {
    const s = createStore(sqliteDb());
    const a = op();
    s.insert(a); s.remove(a.op_id);
    assert.equal(s.get(a.op_id), null);
    assert.equal(s.all().length, 0);
  });

  it('references() matches op:<id> tokens in path OR body — live ops only', () => {
    const s = createStore(sqliteDb());
    const dep = op();
    const child = op({ path: `/docs/op:${dep.op_id}/movements` });
    const bodyChild = op({ body: JSON.stringify({ task_id: `op:${dep.op_id}` }) });
    const clean = op();
    s.insert(dep); s.insert(child); s.insert(bodyChild); s.insert(clean);
    assert.equal(s.references(dep.op_id), true);
    // a matching but already-sent op does not count
    s.update(child.op_id, { status: 'sent' });
    s.update(bodyChild.op_id, { status: 'dead' });
    assert.equal(s.references(dep.op_id), false);
    assert.equal(s.references('nobody'), false);
  });

  it('counts() buckets by status', () => {
    const s = createStore(sqliteDb());
    const ops = [op(), op(), op(), op()];
    ops.forEach((o) => s.insert(o));
    s.update(ops[1].op_id, { status: 'sending' });
    s.update(ops[2].op_id, { status: 'sent' });
    s.update(ops[3].op_id, { status: 'dead' });
    assert.deepEqual(s.counts(), { pending: 1, sending: 1, sent: 1, dead: 1 });
  });

  it('kv round-trips and upserts in place', () => {
    const s = createStore(sqliteDb());
    assert.equal(s.kvGet('missing'), null);
    s.kvSet('rq-cache', '{"a":1}');
    s.kvSet('rq-cache', '{"a":2}');   // upsert, not a second row
    assert.equal(s.kvGet('rq-cache'), '{"a":2}');
  });

  it('a fresh store over the same db sees prior ops — queue survives restart', () => {
    const db = sqliteDb();
    const first = createStore(db);
    const a = op();
    first.insert(a);
    const second = createStore(db);   // same underlying db = "app relaunch"
    assert.equal(second.get(a.op_id).path, '/x');
    assert.equal(second.pending().length, 1);
  });
});
