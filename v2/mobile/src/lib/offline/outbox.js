/** Offline outbox — pure queue/replay engine. No Expo/React Native imports
 *  so `node --test` can drive it with an in-memory store.
 *
 *  Store contract (see store.js for the SQLite implementation):
 *    insert(op)               -> void        append op; seq is auto-assigned
 *    pending()                -> op[]        status='pending'|'sending', by seq
 *    sent()                   -> op[]        status='sent' (sweep candidates)
 *    get(opId)                -> op|null
 *    update(opId, patch)      -> void        merge fields into the row
 *    remove(opId)             -> void
 *    references(depId)        -> bool        any live op with `op:<depId>` in path/body
 *    eachPending(fn)          -> iterate     optional; pending() is enough
 *
 *  Op row: { seq, op_id, org_id, kind, method, path, body, status, error,
 *            result_id, created_at }
 *    kind 'http'          — {method, path, body(json text|null)}
 *    kind 'photo_record'  — body json: {sign_path, photos:[{staged_uri,mime,byte_size}],
 *                                       record_path, record_body}
 *                           record_body strings '{{photos}}' / '{{photo_path}}' are
 *                           replaced with the uploaded array / first storage path.
 *
 *  Dependency tokens: `op:<opId>` inside path or body resolves to the dep's
 *  result_id at replay time, so "create document → move it offline" survives.
 *  An op whose dep is still queued waits; a dead dep deads the dependent. */

const TOKEN = /op:([0-9a-zA-Z-]{8,})/g;

export const OP_PENDING = 'pending';
export const OP_SENDING = 'sending';
export const OP_SENT = 'sent';
export const OP_DEAD = 'dead';

export function newOpId() {
  // crypto.randomUUID exists on Hermes/RN 0.7x+; keep a fallback for node tests.
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Which ops a pending row references via `op:<id>` tokens. */
export function depsOf(op) {
  const text = `${op.path ?? ''}${op.body ?? ''}`;
  const out = new Set();
  for (const m of text.matchAll(TOKEN)) out.add(m[1]);
  return [...out];
}

/** Resolve `op:<dep>` tokens against the store.
 *  -> {text} all deps sent; {wait:true} some dep still queued/sending;
 *     {fail:'...'} a dep died permanently. `text` is the substituted string. */
export function resolveText(store, text) {
  const missing = [];
  const deadDep = [];
  const out = text.replace(TOKEN, (_all, depId) => {
    const dep = store.get(depId);
    if (!dep || dep.status === OP_SENT) {
      if (!dep?.result_id) { missing.push(depId); return `op:${depId}`; }
      return dep.result_id;
    }
    if (dep.status === OP_DEAD) { deadDep.push(depId); return `op:${depId}`; }
    missing.push(depId);
    return `op:${depId}`;
  });
  if (deadDep.length) return { fail: 'An earlier queued change this depends on failed — resend it first.' };
  if (missing.length) return { wait: true };
  return { text: out };
}

function resolveOp(store, op) {
  const p = resolveText(store, op.path ?? '');
  if (p.fail) return { fail: p.fail };
  if (p.wait) return { wait: true };
  const b = op.body == null ? { text: null } : resolveText(store, op.body);
  if (b.fail) return { fail: b.fail };
  if (b.wait) return { wait: true };
  return { path: p.text, body: b.text };
}

/** Queue a plain HTTP op. POST bodies get client_request_id=op_id so the
 *  server dedupes retries (partial unique index per org). */
export function enqueueHttp(store, { orgId, method, path, body = null }) {
  const opId = newOpId();
  let bodyText = null;
  if (body != null) {
    const withId = method === 'POST' && typeof body === 'object' && !Array.isArray(body)
      ? { client_request_id: opId, ...body }
      : body;
    bodyText = JSON.stringify(withId);
  }
  store.insert({
    op_id: opId, org_id: orgId ?? null, kind: 'http', method,
    path, body: bodyText, status: OP_PENDING, error: null,
    result_id: null, created_at: new Date().toISOString(),
  });
  return opId;
}

/** Queue a photo-bearing record as ONE unit: stage → sign → PUT → POST record.
 *  recordBody embeds '{{photos}}' (journal: array slot) or '{{photo_path}}'
 *  (movement: scalar-or-null slot) — replaced with real storage paths on replay. */
export function enqueuePhotoRecord(store, { orgId, signPath, photos, recordPath, recordBody, opId }) {
  opId = opId ?? newOpId();
  store.insert({
    op_id: opId, org_id: orgId ?? null, kind: 'photo_record', method: 'POST',
    path: recordPath,
    body: JSON.stringify({
      sign_path: signPath,
      photos: photos.map((p) => ({ staged_uri: p.staged_uri ?? p.uri, mime: p.mime ?? p.type, byte_size: p.byte_size ?? p.size })),
      record_path: recordPath,
      record_body: recordBody,
    }),
    status: OP_PENDING, error: null, result_id: null,
    created_at: new Date().toISOString(),
  });
  return opId;
}

export function buildRecordBody(template, uploadedPaths) {
  const arr = uploadedPaths.map((p) => ({ storage_path: p.storage_path, mime: p.mime, byte_size: p.byte_size }));
  return JSON.stringify(template)
    .replace('"{{photos}}"', JSON.stringify(arr))
    .replace('"{{photo_path}}"', JSON.stringify(arr[0]?.storage_path ?? null));
}

/** Run one resolved op. `send(method, path, bodyObj, orgId)` must throw
 *  ApiError-style errors with .code; `uploadFile(url, uri, mime)` streams a
 *  staged file to a signed URL. Returns the record response (for result_id). */
async function runOp(op, resolved, send, uploadFile) {
  if (op.kind === 'photo_record') {
    const info = JSON.parse(resolved.body);
    const uploaded = [];
    for (const p of info.photos) {
      const sign = await send('POST', info.sign_path, { mime: p.mime, byte_size: p.byte_size }, op.org_id);
      await uploadFile(sign.upload_url, p.staged_uri, p.mime);
      uploaded.push({ storage_path: sign.path, mime: p.mime, byte_size: p.byte_size });
    }
    const recordBody = JSON.parse(buildRecordBody(info.record_body, uploaded));
    return send(op.method, info.record_path, recordBody, op.org_id);
  }
  return send(op.method, resolved.path, resolved.body ? JSON.parse(resolved.body) : undefined, op.org_id);
}

/** FIFO replay of every pending op. Stops on network failure (still offline /
 *  flaky); dead-letters on API rejections. `onEvent(op, status)` fires per
 *  transition for UI. `onDone(op)` lets the caller clean staged files. */
export async function replayAll(store, send, uploadFile, { onEvent, onDone } = {}) {
  const emit = (op, status) => onEvent?.(op, status);
  for (const op of store.pending()) {
    const resolved = resolveOp(store, op);
    if (resolved.wait) continue;                          // dep still queued
    if (resolved.fail) {                                  // dep is dead
      store.update(op.op_id, { status: OP_DEAD, error: resolved.fail });
      emit(op, OP_DEAD);
      continue;
    }
    store.update(op.op_id, { status: OP_SENDING });
    emit(op, OP_SENDING);
    try {
      const res = await runOp(op, resolved, send, uploadFile);
      store.update(op.op_id, { status: OP_SENT, result_id: res?.data?.id ?? res?.id ?? null });
      emit(op, OP_SENT);
    } catch (e) {
      if (e?.code === 'NETWORK' || e?.code === 'TIMEOUT') {
        store.update(op.op_id, { status: OP_PENDING });
        emit(op, OP_PENDING);
        break;                                          // still offline — resume on next reconnect
      }
      store.update(op.op_id, { status: OP_DEAD, error: e?.message ?? 'Request failed' });
      emit(op, OP_DEAD);
    }
  }
  // Sent rows stay only while a queued op still references them (temp ids).
  for (const row of store.sent()) {
    if (!store.references(row.op_id)) {
      store.remove(row.op_id);
      onDone?.(row);
    }
  }
}
