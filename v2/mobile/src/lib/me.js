/** Shared /me query + active-membership helpers — mobile equivalent of the
 *  Outlet context AppShell passes to web pages ({ me, active }). */
import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import { useAuth } from './auth';
import { useOrgId } from './org';

export function useMe() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['me'],
    queryFn: () => get('/me'),
    enabled: !!session,
  });
}

/** The membership row for the currently-selected org (falls back to the
 *  first membership — same rule as web's AppShell). */
export function useActiveMembership(me) {
  const orgId = useOrgId();
  const memberships = me?.memberships ?? [];
  return memberships.find((m) => m.org_id === orgId) ?? memberships[0] ?? null;
}
