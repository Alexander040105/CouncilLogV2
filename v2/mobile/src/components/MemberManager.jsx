/** Mobile port of MemberManager — shared roster with owner-only role
 *  management + removal. Used by Members and Settings. */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserX, Users } from 'lucide-react-native';
import { get, patch } from '../lib/api';
import { atLeast, useOrgId } from '../lib/org';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { useTheme } from '../lib/theme';
import { Avatar, ConfirmDialog, Empty, ErrorState, Sheet, Skeleton } from './ui';
import { useMe, useActiveMembership } from '../lib/me';

const ROLES = ['adviser', 'officer', 'member'];
const ROLE_HINTS = {
  owner: 'full control — members, invites, settings, audit',
  adviser: 'oversight — read-all, audit view, project & paper writes',
  officer: 'daily work — journal, checklists, papers, signing steps',
  member: 'journal + attendance, read access',
};

export function MemberManager() {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const { t } = useTheme();
  const me = useMe();
  const active = useActiveMembership(me.data);
  const isOwner = active ? atLeast(active.role, 'owner') : false;
  const [removing, setRemoving] = useState(null);
  const [roleFor, setRoleFor] = useState(null);

  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members?pageSize=100`),
    enabled: !!org,
  });

  const update = useMutation({
    mutationFn: ({ uid, ...body }) => patch(`/orgs/${org}/members/${uid}`, body),
    onSuccess: (r) => {
      toast.success(`Updated — now ${r.data.role}${r.data.status === 'removed' ? ' (removed)' : ''}.`);
      setRemoving(null); setRoleFor(null);
      qc.invalidateQueries({ queryKey: ['members', org] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (members.isLoading) return <Skeleton style={{ height: 160 }} />;
  if (members.isError) return <ErrorState error={members.error} retry={members.refetch} />;
  const rows = members.data?.data.filter((m) => m.status === 'active') ?? [];

  if (rows.length === 0) {
    return (
      <Empty icon={<Users size={24} color={t.ink3} />} title="No members yet"
             hint="Share an invite link — an owner can mint one in Settings." />
    );
  }

  return (
    <>
      <View>
        {rows.map((m, i) => {
          const self = m.user_id === session?.user?.id;
          const manageable = isOwner && !self && m.role !== 'owner';
          return (
            <View key={m.user_id} style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              paddingVertical: 8,
              borderTopWidth: i > 0 ? Math.max(t.boxWidth, 1) : 0, borderTopColor: t.line,
            }}>
              <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Avatar name={m.display_name} url={m.avatar_url} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, color: t.ink }} numberOfLines={1}>
                    {m.display_name}
                    {self ? <Text style={{ fontSize: 12, color: t.ink3 }}> (you)</Text> : null}
                  </Text>
                  <Text style={{ fontSize: 12, color: t.ink3 }}>{ROLE_HINTS[m.role]}</Text>
                </View>
              </View>
              {manageable ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Pressable
                    accessibilityRole="button" accessibilityLabel={`Change role for ${m.display_name}`}
                    onPress={() => setRoleFor(m)}
                    style={{
                      minHeight: 36, justifyContent: 'center', paddingHorizontal: 10,
                      borderRadius: t.radiusInput, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor,
                      backgroundColor: t.surface2,
                    }}
                  >
                    <Text style={{ fontSize: 12, color: t.ink2 }}>{m.role}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Remove ${m.display_name}`} accessibilityRole="button" hitSlop={4}
                    onPress={() => setRemoving(m)}
                    style={{ minHeight: 36, minWidth: 36, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <UserX size={16} color={t.alert} />
                  </Pressable>
                </View>
              ) : (
                <Text style={{ fontSize: 12, color: t.ink3 }}>{m.role}</Text>
              )}
            </View>
          );
        })}
      </View>

      <Sheet open={!!roleFor} onClose={() => setRoleFor(null)} title={roleFor ? `Role for ${roleFor.display_name}` : 'Role'}>
        <View style={{ gap: 4 }}>
          {ROLES.map((r) => (
            <Pressable key={r} accessibilityRole="button" disabled={update.isPending}
                       onPress={() => update.mutate({ uid: roleFor.user_id, role: r })}
                       style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: t.radiusInput, borderWidth: r === roleFor?.role ? t.elWidth : 0, borderColor: t.elColor, backgroundColor: r === roleFor?.role ? t.surface3 : 'transparent' }}>
              <Text style={{ fontSize: 14, color: t.ink, fontWeight: r === roleFor?.role ? '700' : '400' }}>{r}</Text>
              <Text style={{ fontSize: 12, color: t.ink3 }}>{ROLE_HINTS[r]}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

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
