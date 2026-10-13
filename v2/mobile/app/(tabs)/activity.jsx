/** Port of web/pages/Activity.jsx — one stream for "what's everyone doing":
 *  dailies people logged and tasks created, interleaved by created_at.
 *  Dailies open the Journal (comments live there), tasks open Tasks. */
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Activity as ActivityIcon, ListTodo, MessageSquare, NotebookPen } from 'lucide-react-native';
import { get } from '../../src/lib/api';
import { useOrgId } from '../../src/lib/org';
import { useTheme } from '../../src/lib/theme';
import { Chip, Empty, ErrorState, PageHeader, Screen, Skeleton } from '../../src/components/ui';

const FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'journal', label: 'Dailies' },
  { id: 'task', label: 'Tasks' },
];

export default function Activity() {
  const { t } = useTheme();
  const router = useRouter();
  const org = useOrgId();
  const [filter, setFilter] = useState('all');
  const journal = useQuery({
    queryKey: ['journal', org],
    queryFn: () => get(`/orgs/${org}/journal?pageSize=50`),
    enabled: !!org,
  });
  const tasks = useQuery({
    queryKey: ['tasks', org],
    queryFn: () => get(`/orgs/${org}/tasks?pageSize=50`),
    enabled: !!org,
  });
  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members?pageSize=100`),
    enabled: !!org,
  });

  const nameOf = (id) =>
    (members.data?.data ?? []).find((m) => m.user_id === id)?.display_name ?? 'Someone';

  const items = useMemo(() => [
    ...(journal.data?.data ?? []).map((e) => ({ kind: 'journal', id: `j-${e.id}`, at: e.created_at, entry: e })),
    ...(tasks.data?.data ?? []).map((x) => ({ kind: 'task', id: `t-${x.id}`, at: x.created_at, task: x })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))
   .filter((i) => filter === 'all' || i.kind === filter),
  [journal.data, tasks.data, filter]);

  const loading = journal.isLoading || tasks.isLoading;
  const failed = journal.isError ? journal : tasks.isError ? tasks : null;
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try { await Promise.all([journal.refetch(), tasks.refetch()]); } finally { setRefreshing(false); }
  };

  const header = (
    <View style={{ gap: 14, marginBottom: 6 }}>
      <PageHeader title="Activity"
                  description="Everything the org is doing — dailies people logged and tasks created, in one stream." />
      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 2,
        borderRadius: t.radiusInput, borderWidth: t.boxWidth, borderColor: t.boxColor, padding: 2,
      }}>
        {FILTERS.map((f) => (
          <Pressable key={f.id} accessibilityRole="button"
                     accessibilityState={{ selected: filter === f.id }}
                     onPress={() => setFilter(f.id)}
                     style={{
                       minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: t.radiusInput,
                       backgroundColor: filter === f.id ? t.navActiveBg : 'transparent',
                     }}>
            <Text style={{ fontSize: 12, fontWeight: t.labelWeight, textTransform: t.labelTransform,
                           letterSpacing: t.labelTracking, color: filter === f.id ? t.navActiveFg : t.ink3 }}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? <Skeleton style={{ height: 192 }} /> : null}
      {failed ? <ErrorState error={failed.error} retry={failed.refetch} what="the activity feed" /> : null}
    </View>
  );

  return (
    <Screen scroll={false} pad={0}>
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        ListEmptyComponent={!loading && !failed ? (
          <Empty icon={<ActivityIcon size={24} color={t.ink3} />} title="Nothing yet"
                 hint="Dailies people log and tasks created will show up here."
                 action={<Pressable accessibilityRole="button" onPress={() => router.push('/journal?compose=1')}>
                   <Text style={{ fontSize: 13, color: t.brand, fontWeight: '700' }}>Log today&apos;s work</Text>
                 </Pressable>} />
        ) : null}
        renderItem={({ item: i }) => i.kind === 'journal' ? (
          <Pressable accessibilityRole="button"
                     onPress={() => router.push(i.entry.task_id ? `/journal?task=${i.entry.task_id}` : '/journal')}>
            <View style={{
              flexDirection: 'row', gap: 12, alignItems: 'flex-start',
              borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor,
              backgroundColor: t.surface2, padding: 12,
            }}>
              <NotebookPen size={18} color={t.brand} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14, color: t.ink }}>
                  <Text style={{ fontWeight: '700' }}>{nameOf(i.entry.member_id)}</Text>
                  {' logged a daily'}
                  {i.entry.task_title ? <Text> on <Text style={{ fontWeight: '700' }}>{i.entry.task_title}</Text></Text> : null}
                </Text>
                <Text style={{ fontSize: 12, color: t.ink2 }} numberOfLines={2}>{i.entry.description}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Text style={{ fontSize: 10, color: t.ink3 }}>{i.entry.entry_date}</Text>
                  {i.entry.comment_count > 0 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                      <MessageSquare size={10} color={t.ink3} />
                      <Text style={{ fontSize: 10, color: t.ink3 }}>{i.entry.comment_count}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => router.push('/tasks')}>
            <View style={{
              flexDirection: 'row', gap: 12, alignItems: 'flex-start',
              borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor,
              backgroundColor: t.surface2, padding: 12,
            }}>
              <ListTodo size={18} color={t.accent} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14, color: t.ink }}>
                  <Text style={{ fontWeight: '700' }}>{nameOf(i.task.creator_id)}</Text>
                  {' created a task — '}
                  <Text style={{ fontWeight: '700' }}>{i.task.title}</Text>
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Chip kind={i.task.status === 'done' ? 'done' : 'pending'} label={i.task.status} />
                  <Text style={{ fontSize: 10, color: t.ink3 }}>
                    {(i.task.assignee_ids ?? (i.task.assignee_id ? [i.task.assignee_id] : [])).length > 0
                      ? `→ ${(i.task.assignee_ids ?? [i.task.assignee_id]).map(nameOf).join(', ')}` : ''}
                    {i.task.due_date ? ` due ${i.task.due_date}` : ''}
                  </Text>
                </View>
              </View>
            </View>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        initialNumToRender={14}
        maxToRenderPerBatch={10}
        windowSize={7}
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.ink3} />}
      />
    </Screen>
  );
}
