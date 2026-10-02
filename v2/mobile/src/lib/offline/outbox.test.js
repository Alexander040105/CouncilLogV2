/** node --test — pure engine coverage: enqueue shape, client_request_id
 *  injection, FIFO replay, temp-id resolution, network-stop, dead-letter,
 *  photo_record composite ordering. No Expo imports needed. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecordBody, depsOf, enqueueHttp, enqueuePhotoRecord, replayAll, resolveText,
} from './outbox.js';

function memStore() {
  const rows = [];
  let seq = 0;
  return {
    rows,
    insert(op) { rows.push({ seq: ++seq, ...op }); },
    pending() { return rows.filter((r) => ['pending', 'sending'].includes(r.status)).sort((a, b) => a.seq - b.seq); },
    sent() { return rows.filter((r) => r.status === 'sent'); },
    all() { return [...rows].sort((a, b) => a.seq - b.seq); },
    get(opId) { return rows.find((r) => r.op_id === opId) ?? null; },
    update(opId, patch) { Object.assign(rows.find((r) => r.op_id === opId), patch); },
    remove(opId) { rows.splice(rows.findIndex((r) => r.op_id === opId), 1); },
    references(depId) {
      return rows.some((r) => ['pending', 'sending'].includes(r.status)
        && (r.path?.includes(`op:${depId}`) || r.body?.includes(`op:${depId}`)));
    },
  };
}

const netErr = () => { const e = new Error('down'); e.code = 'NETWORK'; return e; };
const send = (log, impl) => async (m, p, b, org) => {
  log.push([m, p, b]);
  return impl ? impl(m, p, b, org) : { data: { id: `srv-${p.split('/').pop()}` } };
};

describe('enqueueHttp', () => {
  it('injects client_request_id on POST bodies for server dedupe', () => {
    const s = memStore();
    const id = enqueueHttp(s, { orgId: 'o1', method: 'POST', path: '/orgs/o1/tasks', body: { title: 'x' } });
    const op = s.get(id);
    assert.equal(JSON.parse(op.body).client_request_id, id);
    assert.equal(op.status, 'pending');
  });
  it('leaves PATCH bodies untouched', () => {
    const s = memStore();
    const id = enqueueHttp(s, { orgId: 'o1', method: 'PATCH', path: '/p', body: { title: 'x' } });
    assert.equal(JSON.parse(s.get(id).body).client_request_id, undefined);
  });
});

describe('replay ordering', () => {
  it('sends FIFO by seq and sweeps sent ops', async () => {
    const s = memStore();
    enqueueHttp(s, { orgId: 'o', method: 'POST', path: '/a', body: { n: 1 } });
    enqueueHttp(s, { orgId: 'o', method: 'POST', path: '/b', body: { n: 2 } });
    const log = [];
    await replayAll(s, send(log));
    assert.deepEqual(log.map(([, p]) => p), ['/a', '/b']);
    assert.equal(s.all().length, 0); // both swept
  });

  it('stops on NETWORK and leaves the rest pending', async () => {
    const s = memStore();
    enqueueHttp(s, { orgId: 'o', method: 'POST', path: '/a' });
    enqueueHttp(s, { orgId: 'o', method: 'POST', path: '/b' });
    let calls = 0;
    await replayAll(s, async () => { calls += 1; if (calls === 1) throw netErr(); return { data: {} }; });
    assert.equal(s.pending()[0].path, '/a');
    assert.equal(s.pending()[1].path, '/b');
  });

  it('dead-letters API errors and keeps going', async () => {
    const s = memStore();
    enqueueHttp(s, { orgId: 'o', method: 'POST', path: '/a' });
    enqueueHttp(s, { orgId: 'o', method: 'POST', path: '/b' });
    let calls = 0;
    await replayAll(s, async () => {
      calls += 1;
      if (calls === 1) { const e = new Error('nope'); e.code = 'HTTP_422'; throw e; }
      return { data: {} };
    });
    assert.equal(s.get(s.all()[0].op_id).status, 'dead');
    assert.equal(s.all()[0].error, 'nope');
    assert.equal(s.all().length, 1); // /b swept
  });
});

describe('temp-id resolution', () => {
  it('substitutes op:<id> tokens with the dep result_id', async () => {
    const s = memStore();
    const dep = enqueueHttp(s, { orgId: 'o', method: 'POST', path: '/docs', body: {} });
    enqueueHttp(s, { orgId: 'o', method: 'POST', path: `/docs/op:${dep}/movements`, body: { loc: 'x' } });
    const log = [];
    await replayAll(s, send(log, () => ({ data: { id: 'real-1' } })));
    assert.equal(log[1][1], '/docs/real-1/movements');
    assert.equal(s.all().length, 0);
  });

  it('waits when the dep is still queued; deads dependents of a dead dep', async () => {
    const s = memStore();
    const dep = enqueueHttp(s, { orgId: 'o', method: 'POST', path: '/docs' });
    const child = enqueueHttp(s, { orgId: 'o', method: 'POST', path: `/docs/op:${dep}/movements` });
    assert.equal(resolveText(s, `/docs/op:${dep}/x`).wait, true);
    s.update(dep, { status: 'dead' });
    assert.equal(resolveText(s, `/docs/op:${dep}/x`).fail !== undefined, true);
    const log = [];
    await replayAll(s, send(log));
    assert.equal(s.get(child).status, 'dead');
    assert.deepEqual(depsOf(s.get(child)), [dep]);
  });
});

describe('photo_record', () => {
  it('signs → uploads → posts the record with real storage paths', async () => {
    const s = memStore();
    enqueuePhotoRecord(s, {
      orgId: 'o', signPath: '/sign',
      photos: [{ staged_uri: 'file:///a.jpg', mime: 'image/jpeg', byte_size: 10 }],
      recordPath: '/journal',
      recordBody: { description: 'd', photos: '{{photos}}' },
    });
    const log = [];
    const uploads = [];
    await replayAll(s,
      send(log, (m, p) => (p === '/sign' ? { upload_url: 'https://up', path: 'org/p.jpg' } : { data: { id: 'e1' } })),
      async (url, uri) => uploads.push([url, uri]));
    assert.deepEqual(log.map(([, p]) => p), ['/sign', '/journal']);
    assert.deepEqual(uploads, [['https://up', 'file:///a.jpg']]);
    const posted = log[1][2];
    assert.equal(posted.photos[0].storage_path, 'org/p.jpg');
    assert.equal(s.all().length, 0);
  });

  it('{{photo_path}} becomes null with zero photos', () => {
    const out = JSON.parse(buildRecordBody({ photo_path: '{{photo_path}}', note: null }, []));
    assert.equal(out.photo_path, null);
  });
});
