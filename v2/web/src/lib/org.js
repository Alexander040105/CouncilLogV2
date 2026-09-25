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
