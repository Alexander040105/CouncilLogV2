/** Active org context: persisted per-browser so the API client can stamp
 *  X-Org-Id on every request. Memberships come from GET /me. */

const KEY = 'councilog.orgId';

export function currentOrgId() {
  return localStorage.getItem(KEY);
}

export function setCurrentOrg(id) {
  if (id) localStorage.setItem(KEY, id);
  else localStorage.removeItem(KEY);
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
