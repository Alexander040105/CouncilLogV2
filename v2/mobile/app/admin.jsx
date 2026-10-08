/** Port of web/pages/Admin.jsx — platform-wide org list, rosters,
 *  archive/restore. Server enforces is_admin (403 otherwise). */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, ShieldCheck, UserX } from 'lucide-react-native';
import { get, patch, post } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { useToast } from '../src/lib/toast';
import { useTheme } from '../src/lib/theme';
import { useMe } from '../src/lib/me';
import { humanize } from '../src/lib/labels';
import {
  Avatar, Card, Chip, ConfirmDialog, Empty, ErrorState, PageHeader, Screen, Skeleton,
} from '../src/components/ui';

export default function Admin() {
  const me = useMe();
  const qc = useQueryClient();

  const orgs = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => get('/admin/orgs?pageSize=100'),
    enabled: !!me.data?.is_admin,
  });

  if (me.data === undefined) {
    return <Screen><Skeleton style={{ height: 192 }} /></Screen>;
  }
  if (!me.data?.is_admin) {
    return (
      <Screen>
        <Empty
          icon={<ShieldCheck size={24} />}
          title="CounciLog admins only"
          hint="This page is for the platform team. There's nothing here for your account — head back to Today."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader
        title="Admin"
        description="Every org on this CounciLog — open one to see its roster, remove members, or archive/restore it. Everything you do lands in that org's audit log under your name."
      />
      {orgs.isLoading ? <Skeleton style={{ height: 192 }} /> : null}
      {orgs.isError ? <ErrorState error={orgs.error} retry={orgs.refetch} what="organizations" /> : null}
      {orgs.data?.data.length === 0 ? (
        <Empty title="No organizations yet" hint="Orgs appear here as they're created." />
      ) : null}
      {orgs.data?.data.map((o) => <OrgRow key={o.id} org={o} qc={qc} />)}
    </Screen>
  );
}

function OrgRow({ org, qc }) {
  const { session } = useAuth();
  const toast = useToast();
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(null);     // member object
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
    <Card style={{ padding: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 16 }}
        onPress={() => setOpen(!open)}
      >
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {open ? <ChevronDown size={16} color={t.ink} /> : <ChevronRight size={16} color={t.ink} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }} numberOfLines={1}>{org.name}</Text>
            <Text style={{ fontSize: 12, color: t.ink3 }}>
              {org.slug} · {org.member_count} member{org.member_count === 1 ? '' : 's'}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Chip kind={archived ? 'alert' : 'done'} label={archived ? 'Archived' : 'Active'} />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => setConfirming(archived ? 'restore' : 'archive')}
            style={{
              minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10,
              borderRadius: t.radiusInput, borderWidth: t.elWidth, borderColor: t.elColor,
              backgroundColor: t.surface2, opacity: busy ? 0.5 : 1,
            }}
          >
            {archived
              ? <ArchiveRestore size={15} color={t.ink} />
              : <Archive size={15} color={t.ink} />}
            <Text style={{ fontSize: 12, fontWeight: '700', color: t.ink }}>
              {archived ? 'Restore' : 'Archive'}
            </Text>
          </Pressable>
        </View>
      </Pressable>

      {open ? (
        <View style={{ borderTopWidth: 1, borderTopColor: t.line, paddingHorizontal: 16, paddingBottom: 8 }}>
          {members.isLoading ? <Skeleton style={{ height: 96, marginVertical: 12 }} /> : null}
          {members.isError ? <ErrorState error={members.error} retry={members.refetch} what="members" /> : null}
          {members.data?.data.filter((m) => m.status === 'active').length === 0 ? (
            <Text style={{ paddingVertical: 12, fontSize: 14, color: t.ink3 }}>No active members.</Text>
          ) : null}
          {members.data?.data.filter((m) => m.status === 'active').map((m, i) => {
            const self = m.user_id === session?.user?.id;
            return (
              <View key={m.user_id} style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                paddingVertical: 8, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: t.line,
              }}>
                <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Avatar name={m.display_name} url={m.avatar_url} />
                  <Text style={{ flex: 1, minWidth: 0, fontSize: 14, color: t.ink }} numberOfLines={1}>
                    {m.display_name}
                    {self ? <Text style={{ fontSize: 12, color: t.ink3 }}> (you)</Text> : null}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 12, color: t.ink3 }}>{humanize(m.role)}</Text>
                  {!self ? (
                    <Pressable
                      accessibilityLabel={`Remove ${m.display_name} from ${org.name}`}
                      accessibilityRole="button"
                      style={{ minHeight: 36, minWidth: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}
                      onPress={() => setRemoving(m)}
                    >
                      <UserX size={16} color={t.alert} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

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
