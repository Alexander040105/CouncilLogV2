/** Active org context: persisted per-device so the API client can stamp
 *  X-Org-Id on every request. Memberships come from GET /me.
 *
 *  Web stores this in localStorage (sync). RN storage is async, so the module
 *  keeps an in-memory copy hydrated once at boot (hydrateOrg in _layout) and
 *  writes through to AsyncStorage — currentOrgId() stays synchronous so call
 *  sites ported from the web work unchanged. */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'councilog.orgId';
const PICKED_KEY = 'councilog.orgPicked';
let cached = null;
let picked = null;
let hydrated = false;
const listeners = new Set();

export async function hydrateOrg() {
  const [orgId, flag] = await Promise.all([
    AsyncStorage.getItem(KEY).catch(() => null),
    AsyncStorage.getItem(PICKED_KEY).catch(() => null),
  ]);
  cached = orgId;
  picked = flag;
  hydrated = true;
  return cached;
}

export function orgHydrated() { return hydrated; }

export function currentOrgId() {
  return cached;
}

export function setCurrentOrg(id) {
  cached = id ?? null;
  if (id) AsyncStorage.setItem(KEY, id).catch(() => {});
  else AsyncStorage.removeItem(KEY).catch(() => {});
  listeners.forEach((fn) => fn());
}

/** "Did the user pick an org since signing in?" — cleared on sign-out so the
 *  next login with 2+ memberships lands on the picker, not a silent default. */
export function orgPicked() { return picked === '1'; }
export function setOrgPicked(v = true) {
  picked = v ? '1' : null;
  if (v) AsyncStorage.setItem(PICKED_KEY, '1').catch(() => {});
  else AsyncStorage.removeItem(PICKED_KEY).catch(() => {});
}

/** Reactive org id — screens key their queries by this so switching orgs
 *  refires everything (web gets the same effect via AppShell re-render). */
export function useOrgId() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => cached,
  );
}

export const ROLE_RANK = { member: 0, officer: 1, adviser: 2, owner: 3 };
export const atLeast = (role, min) => (ROLE_RANK[role] ?? -1) >= ROLE_RANK[min];

/** "Today" as YYYY-MM-DD in the org timezone — mirrors the server's
 *  org_today() (Asia/Manila). Using toISOString() here would give UTC,
 *  which is a day behind for the first 8 hours of every Manila morning. */
const ORG_TZ = 'Asia/Manila';
export function todayOrg(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: ORG_TZ }).format(d);
}
