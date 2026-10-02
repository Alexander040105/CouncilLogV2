/** Outbox wiring: binds the real API sender + file uploader to the pure
 *  engine, exposes the UI surface (subscribe/counts/list/retry/discard),
 *  and serializes replays so a NetInfo flurry can't double-send. */
import { onlineManager } from '@tanstack/react-query';
import { buildRecordBody, enqueueHttp, enqueuePhotoRecord, newOpId, replayAll } from './outbox';
import { stagePhoto, store, unstageOp } from './store';
import { putToSignedUrl } from '../../components/PhotoPicker';

let send = null;          // apiRaw — injected by api.js (avoids an import cycle)
let replaying = null;     // in-flight replay promise
const listeners = new Set();

export function bindApiSender(fn) { send = fn; }

export function subscribeOutbox(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() { for (const fn of listeners) fn(); }

export function queueCounts() { return store.counts(); }
export function listOps() { return store.all(); }

/** Queue a failed/plain HTTP mutation. Returns the op_id — also the
 *  client_request_id the server dedupes on. */
export function enqueueWrite({ method, path, body, orgId }) {
  const opId = enqueueHttp(store, { orgId, method, path, body });
  emit();
  return opId;
}

/** Queue a photo-bearing record (journal entry / movement) as one unit.
 *  Photos are staged to the document directory now so they survive restart.
 *  recordBody uses '{{photos}}' or '{{photo_path}}' placeholder strings. */
export async function enqueuePhoto({ orgId, signPath, photos, recordPath, recordBody }) {
  const opId = newOpId();
  const staged = [];
  for (const [i, p] of photos.entries()) {
    const uri = await stagePhoto(p.uri, opId, i);
    staged.push({ staged_uri: uri, mime: p.type, byte_size: p.size });
  }
  const id = enqueuePhotoRecord(store, {
    orgId, signPath, photos: staged, recordPath, recordBody, opId,
  });
  emit();
  return id;
}

/** Upload straight through when online — the same composite the queue
 *  replays offline, so both paths produce identical server state. */
export async function runPhotoRecord({ signPath, photos, recordPath, recordBody, sendFn }) {
  const s = sendFn ?? send;
  const uploaded = [];
  for (const p of photos) {
    const sign = await s('POST', signPath, { mime: p.mime ?? p.type, byte_size: p.byte_size ?? p.size });
    await putToSignedUrl(sign.upload_url, p);
    uploaded.push({ storage_path: sign.path, mime: p.mime ?? p.type, byte_size: p.byte_size ?? p.size });
  }
  return s('POST', recordPath, JSON.parse(buildRecordBody(recordBody, uploaded)));
}

/** The one call screens make for photo-bearing creates: online → sign/upload/
 *  record immediately; offline (or the connection dies mid-flight) → stage the
 *  photos and queue the whole composite for replay. Returns the server
 *  response or {queued:true, op_id}. */
export async function submitPhotoRecord(args) {
  if (onlineManager.isOnline()) {
    try {
      return await runPhotoRecord(args);
    } catch (e) {
      if (e?.code !== 'NETWORK' && e?.code !== 'TIMEOUT') throw e;
    }
  }
  const opId = await enqueuePhoto(args);
  return { queued: true, op_id: opId };
}

/** Replay everything queued. Safe to call from any connectivity change —
 *  concurrent calls join the in-flight pass instead of double-sending. */
export async function replayQueue() {
  if (replaying) return replaying;
  if (!send) return;
  replaying = (async () => {
    try {
      await replayAll(store, send,
        (url, uri, mime) => putToSignedUrl(url, { uri, type: mime }), {
        onEvent: emit,
        onDone: (op) => { unstageOp(op).catch(() => {}); },
      });
    } finally {
      replaying = null;
      emit();
    }
  })();
  return replaying;
}

/** Dead-letter controls for the Pending screen. */
export function retryOp(opId) {
  const op = store.get(opId);
  if (!op) return;
  store.update(opId, { status: 'pending', error: null });
  emit();
  replayQueue().catch(() => {});
}

export function discardOp(opId) {
  const op = store.get(opId);
  if (op) unstageOp(op).catch(() => {});
  store.remove(opId);
  emit();
}
