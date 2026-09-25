import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { UserX, Users } from 'lucide-react';
import { get, patch } from '../lib/api';
import { atLeast, currentOrgId } from '../lib/org';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Avatar, ConfirmDialog, Empty, Select, Skeleton } from './ui';

const ROLES = ['adviser', 'officer', 'member'];
const ROLE_HINTS = {
  owner: 'full control — members, invites, settings, audit',
  adviser: 'oversight — read-all, audit view, project & paper writes',
  officer: 'daily work — journal, checklists, papers, signing steps',
  member: 'journal + attendance, read access',
};

/** Shared roster with owner-only role management. Used by Members + Settings. */
export function MemberManager() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const { active } = useOutletContext() ?? {};
  const isOwner = active ? atLeast(active.role, 'owner') : false;
  const [removing, setRemoving] = useState(null);

  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members?pageSize=100`),
  });

  const update = useMutation({
    mutationFn: ({ uid, ...body }) => patch(`/orgs/${org}/members/${uid}`, body),
    onSuccess: (r) => {
      toast.success(`Updated — now ${r.data.role}${r.data.status === 'removed' ? ' (removed)' : ''}.`);
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ['members', org] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (members.isLoading) return <Skeleton className="h-40" />;
  const rows = members.data?.data.filter((m) => m.status === 'active') ?? [];

  if (rows.length === 0) {
    return (
      <Empty icon={<Users size={24} />} title="No members yet"
             hint="Share an invite link — an owner can mint one in Settings." />
    );
  }

  return (
    <>
      <div className="divide-y divide-[var(--color-line)]">
        {rows.map((m) => {
          const self = m.user_id === session?.user?.id;
          const manageable = isOwner && !self && m.role !== 'owner';
          return (
            <div key={m.user_id} className="flex items-center justify-between gap-2 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={m.display_name} url={m.avatar_url} />
                <div className="min-w-0">
                  <div className="truncate text-sm">
                    {m.display_name}
                    {self && <span className="ml-1 text-xs text-[var(--color-ink-3)]">(you)</span>}
                  </div>
                  <div className="text-xs text-[var(--color-ink-3)]">{ROLE_HINTS[m.role]}</div>
                </div>
              </div>
              {manageable ? (
                <div className="flex items-center gap-1">
                  <Select
                    value={m.role} aria-label={`Role for ${m.display_name}`}
                    className="min-h-[36px] text-xs"
                    onChange={(e) => update.mutate({ uid: m.user_id, role: e.target.value })}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                  <button
                    aria-label={`Remove ${m.display_name}`}
                    className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded text-[var(--color-status-alert)] hover:bg-[var(--color-surface-3)]"
                    onClick={() => setRemoving(m)}
                  >
                    <UserX size={16} />
                  </button>
                </div>
              ) : (
                <span className="text-xs text-[var(--color-ink-3)]">{m.role}</span>
              )}
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => update.mutate({ uid: removing.user_id, status: 'removed' })}
        busy={update.isPending}
        title={`Remove ${removing?.display_name}?`}
        body="They lose access to this org immediately. Their journal entries and audit history stay on record."
        confirmLabel="Remove member"
      />
    </>
  );
}
