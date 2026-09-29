/** Notifications inbox — mobile port of web's NotificationBell sheet as a
 *  full screen. Unread badge polls every 30s; tap a row to mark read and
 *  deep-link to the thing it points at. */
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, CheckCheck } from 'lucide-react-native';
import { get, post } from '../src/lib/api';
import { useOrgId } from '../src/lib/org';
import { useTheme } from '../src/lib/theme';
import { Button, Card, Empty, ErrorState, PageHeader, Screen, Skeleton } from '../src/components/ui';

/** Deep-link target for a notification's payload entity (mobile routes). */
function targetFor(n) {
  const { entity_type, entity_id } = n.payload ?? {};
  if (entity_type === 'task' && entity_id) return `/tasks?task=${entity_id}`;
  if (entity_type === 'project' && entity_id) return `/project/${entity_id}`;
  if (entity_type === 'document' && entity_id) return `/document/${entity_id}`;
  if (entity_type === 'journal') return '/journal';
  return null;
}

function lineFor(n) {
  const p = n.payload ?? {};
  if (n.kind === 'assigned') return `${p.by ?? 'Someone'} assigned you: ${p.title ?? ''}`;
  if (n.kind === 'task_commented') return `${p.by ?? 'Someone'} commented on ${p.title ?? 'a task'}`;
  if (n.kind === 'task_due_soon') return `"${p.title ?? 'A task'}" is due tomorrow`;
  if (n.kind === 'duty_reminder') return 'You’re on duty today and haven’t filed yet';
  return p.title ?? 'Notification';
}

function ago(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function Notifications() {
  const org = useOrgId();
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useTheme();

  const notifs = useQuery({
    queryKey: ['notifications', org],
    queryFn: () => get(`/orgs/${org}/notifications`),
    enabled: !!org,
  });
  const unread = notifs.data?.unread ?? 0;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications', org] });
  const markRead = useMutation({
    mutationFn: (ids) => post(`/orgs/${org}/notifications/read`, { ids }),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: () => post(`/orgs/${org}/notifications/read-all`),
    onSuccess: invalidate,
  });

  const open_ = (n) => {
    if (!n.read_at) markRead.mutate([n.id]);
    const target = targetFor(n);
    if (target) router.push(target);
  };

  return (
    <Screen refresh={notifs.refetch}>
      <Pressable accessibilityRole="button" onPress={() => router.back()}
                 style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} color={t.ink3} /><Text style={{ fontSize: 14, color: t.ink3 }}>Back</Text>
      </Pressable>
      <PageHeader
        title="Notifications"
        description="Assignments and reminders land here."
        action={unread > 0 ? (
          <Button variant="secondary" onPress={() => markAll.mutate()} disabled={markAll.isPending}>
            <CheckCheck size={14} color={t.ink2} /><Text style={{ color: t.ink2, fontWeight: '700' }}>Mark all read</Text>
          </Button>
        ) : null}
      />

      {notifs.isLoading ? <Skeleton style={{ height: 192 }} /> : null}
      {notifs.isError ? <ErrorState error={notifs.error} retry={notifs.refetch} /> : null}
      {notifs.data?.data.length === 0 ? (
        <Empty icon={<Bell size={24} color={t.ink3} />} title="All quiet"
               hint="Assignments and reminders land here — nothing yet." />
      ) : null}

      <View style={{ gap: 6 }}>
        {(notifs.data?.data ?? []).map((n) => (
          <Pressable key={n.id} accessibilityRole="button" onPress={() => open_(n)}>
            <Card style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, opacity: n.read_at ? 0.65 : 1 }}>
              <View style={{
                marginTop: 6, height: 8, width: 8, borderRadius: 999,
                backgroundColor: n.read_at ? 'transparent' : t.brand,
              }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14, color: t.ink, fontWeight: n.read_at ? '400' : '600' }}>
                  {lineFor(n)}
                </Text>
                <Text style={{ fontSize: 12, color: t.ink3 }}>{ago(n.created_at)}</Text>
              </View>
            </Card>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
