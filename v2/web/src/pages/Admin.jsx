import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ArchiveRestore, Archive, ChevronDown, ChevronRight, ShieldCheck, UserX } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import {
  Avatar, Button, Card, Chip, ConfirmDialog, Empty, ErrorState, PageHeader, Skeleton,
} from '../components/ui';

/** Platform-wide view — every org, archived or not. Only reachable for
 *  profiles.is_admin users; the server enforces it (403 otherwise). */
export default function Admin() {
  const { me } = useOutletContext() ?? {};
  const qc = useQueryClient();

  const orgs = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => get('/admin/orgs?pageSize=100'),
    enabled: !!me?.is_admin,
  });

  if (me === undefined) return <Skeleton className="h-48" />;
  if (!me?.is_admin) {
    return (
      <Empty
        icon={<ShieldCheck size={24} />}
        title="CounciLog admins only"
        hint="This page is for the platform team. There's nothing here for your account — head back to Today."
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Admin"
        description="Every org on this CounciLog — open one to see its roster, remove members, or archive/restore it. Everything you do lands in that org's audit log under your name."
      />
      {orgs.isLoading && <Skeleton className="h-48" />}
      {orgs.isError && <ErrorState error={orgs.error} retry={orgs.refetch} />}
      {orgs.data?.data.length === 0 && (
        <Empty title="No organizations yet" hint="Orgs appear here as they're created." />
      )}
      <div className="space-y-2">
        {orgs.data?.data.map((o) => <OrgRow key={o.id} org={o} qc={qc} />)}
      </div>
    </div>
  );
}

function OrgRow({ org, qc }) {
  const { session } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(null);   // member object
  const [confirming, setConfirming] = useState(null); // 'archive' | 'restore'
  const archived = !!org.archived_at;

  const members = useQuery({
    queryKey: ['admin-org-members', org.id],
    queryFn: () => get(`/orgs/${org.id}/members?pageSize=100`, { org: org.id }),
    enabled: open,
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['admin-orgs'] });
    await qc.invalidateQueries({ queryKey: ['admin-org-members', org.id] });
    await qc.invalidateQueries({ queryKey: ['me'] });
  };

  const remove = useMutation({
    mutationFn: (uid) => patch(`/orgs/${org.id}/members/${uid}`, { status: 'removed' }, { org: org.id }),
    onSuccess: async () => { toast.success('Member removed.'); setRemoving(null); await refresh(); },
    onError: (e) => { setRemoving(null); toast.error(e.message); },
  });

  const archive = useMutation({
    mutationFn: () => post(`/orgs/${org.id}/archive`, {}, { org: org.id }),
    onSuccess: async () => { toast.success(`Archived ${org.name}.`); setConfirming(null); await refresh(); },
    onError: (e) => { setConfirming(null); toast.error(e.message); },
  });

  const restore = useMutation({
    mutationFn: () => post(`/admin/orgs/${org.id}/restore`),
    onSuccess: async () => { toast.success(`Restored ${org.name}.`); setConfirming(null); await refresh(); },
    onError: (e) => { setConfirming(null); toast.error(e.message); },
  });

  const busy = archive.isPending || restore.isPending || remove.isPending;

  return (
    <Card className="p-0">
      <button
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{org.name}</span>
            <span className="text-xs text-[var(--color-ink-3)]">
              {org.slug} · {org.member_count} member{org.member_count === 1 ? '' : 's'}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Chip
            kind={archived ? 'alert' : 'done'}
            label={archived ? 'archived' : 'active'}
          />
          {archived ? (
            <Button variant="secondary" disabled={busy} onClick={(e) => { e.stopPropagation(); setConfirming('restore'); }}>
              <ArchiveRestore size={15} aria-hidden /> Restore
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={(e) => { e.stopPropagation(); setConfirming('archive'); }}>
              <Archive size={15} aria-hidden /> Archive
            </Button>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--color-line)] px-4 pb-2">
          {members.isLoading && <Skeleton className="my-3 h-24" />}
          {members.isError && <ErrorState error={members.error} retry={members.refetch} />}
          {members.data?.data.filter((m) => m.status === 'active').length === 0 && (
            <p className="py-3 text-sm text-[var(--color-ink-3)]">No active members.</p>
          )}
          <div className="divide-y divide-[var(--color-line)]">
            {members.data?.data.filter((m) => m.status === 'active').map((m) => {
              const self = m.user_id === session?.user?.id;
              return (
                <div key={m.user_id} className="flex items-center justify-between gap-2 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar name={m.display_name} url={m.avatar_url} />
                    <span className="min-w-0 truncate text-sm">
                      {m.display_name}
                      {self && <span className="ml-1 text-xs text-[var(--color-ink-3)]">(you)</span>}
                    </span>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-[var(--color-ink-3)]">{m.role}</span>
                    {!self && (
                      <button
                        aria-label={`Remove ${m.display_name} from ${org.name}`}
                        className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded text-[var(--color-status-alert)] hover:bg-[var(--color-surface-3)]"
                        onClick={() => setRemoving(m)}
                      >
                        <UserX size={16} />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove.mutate(removing.user_id)}
        busy={remove.isPending}
        title={`Remove ${removing?.display_name}?`}
        body={`They lose access to ${org.name} immediately. Their journal entries and history stay on record. The only owner can't be removed — hand off ownership first.`}
        confirmLabel="Remove member"
      />
      <ConfirmDialog
        open={confirming === 'archive'}
        onClose={() => setConfirming(null)}
        onConfirm={() => archive.mutate()}
        busy={archive.isPending}
        title={`Archive ${org.name}?`}
        body="The org disappears for every member — projects, papers, journals, all of it hidden. Nothing is deleted and the audit trail stays; only a CounciLog admin can bring it back."
        confirmLabel="Archive org"
        requireText={org.name}
      />
      <ConfirmDialog
        open={confirming === 'restore'}
        onClose={() => setConfirming(null)}
        onConfirm={() => restore.mutate()}
        busy={restore.isPending}
        danger={false}
        title={`Restore ${org.name}?`}
        body="The org and all its data become visible to its members again."
        confirmLabel="Restore org"
      />
    </Card>
  );
}
