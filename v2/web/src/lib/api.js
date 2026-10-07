import { accessToken } from './supabase';
import { currentOrgId } from './org';

if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  // Vite bakes env vars at build time — a missing VITE_API_URL silently
  // produces a bundle that calls localhost. Fail loudly instead.
  throw new Error('VITE_API_URL is not set. Add it to the host\'s env vars and redeploy.');
}
export const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1';
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
/** Registered once in main.jsx: signs out and returns the user to /login
 *  when the server rejects the session mid-use. */
export function setAuthFailureHandler(fn) { onAuthFailure = fn; }

export async function api(path, opts = {}) {
  // currentOrgId() is non-reactive — a page can fire before /me resolves and
  // AppShell writes it, producing literal /orgs/null/... paths (a 422).
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

export const get = (path, opts) => api(path, opts);
export const post = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
export const patch = (path, body, opts) => api(path, { ...opts, method: 'PATCH', body });
export const put = (path, body, opts) => api(path, { ...opts, method: 'PUT', body });
export const del = (path, opts) => api(path, { ...opts, method: 'DELETE' });
