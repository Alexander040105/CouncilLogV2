/** 1:1 port of web/src/lib/api.js — same Bearer JWT + x-org-id contract, same
 *  error shape. Plus an offline layer: a write that fails on NETWORK/TIMEOUT
 *  is queued to the SQLite outbox and replayed on reconnect — the caller gets
 *  {queued:true, op_id} instead of an error. */
import { accessToken } from './supabase';
import { currentOrgId } from './org';
import { bindApiSender, enqueueWrite } from './offline';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';
const DEFAULT_TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let onAuthFailure = null;
/** Registered once in app/_layout.jsx: signs out and returns the user to
 *  /login when the server rejects the session mid-use. */
export function setAuthFailureHandler(fn) { onAuthFailure = fn; }

export async function apiRaw(path, opts = {}) {
  // currentOrgId() is non-reactive — a screen can fire before /me resolves and
  // the shell writes it, producing literal /orgs/null/... paths (a 422).
  if (path.includes('/orgs/null/') || path.includes('/orgs/undefined/')) {
    throw new ApiError('ORG_LOADING', 'Still loading your organization — wait a second and try again.', 0);
  }
  const token = await accessToken();
  const orgId = opts.org === undefined ? currentOrgId() : opts.org;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? DEFAULT_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: opts.method ?? 'GET',
      signal: ctrl.signal,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(orgId ? { 'x-org-id': orgId } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'The request timed out — check your connection and try again.', 0);
    }
    throw new ApiError('NETWORK', "Can't reach the server — check your internet connection and try again.", 0);
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401) {
    onAuthFailure?.();
    const e = json?.error;
    throw new ApiError(e?.code ?? 'UNAUTHENTICATED', e?.message ?? 'Your session expired — sign in again.', 401, e?.details);
  }
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(e?.code ?? 'HTTP_' + res.status, e?.message ?? res.statusText, res.status, e?.details);
  }
  return json;
}

/** Reads hit the network directly (React Query serves cached data offline);
 *  writes that can't reach the server queue to the outbox instead of throwing. */
export async function api(path, opts = {}) {
  try {
    return await apiRaw(path, opts);
  } catch (e) {
    const isWrite = (opts.method ?? 'GET') !== 'GET';
    if (!isWrite || (e.code !== 'NETWORK' && e.code !== 'TIMEOUT')) throw e;
    const opId = enqueueWrite({
      method: opts.method, path, body: opts.body,
      orgId: opts.org ?? path.match(/\/orgs\/([^/]+)/)?.[1] ?? currentOrgId(),
    });
    return { queued: true, op_id: opId };
  }
}

bindApiSender(apiRaw);

export const isQueued = (r) => r?.queued === true;

/** Mutation onSuccess copy: a queued write did NOT reach the server yet —
 *  say so honestly (never a silent no-op). */
export const queuedMsg = (r, okMsg) =>
  isQueued(r) ? 'Saved on this device — sends when you’re back online.' : okMsg;

export const get = (path, opts) => api(path, opts);
export const post = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
export const patch = (path, body, opts) => api(path, { ...opts, method: 'PATCH', body });
export const put = (path, body, opts) => api(path, { ...opts, method: 'PUT', body });
export const del = (path, opts) => api(path, { ...opts, method: 'DELETE' });
