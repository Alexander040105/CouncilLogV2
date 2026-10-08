/** Agenda — mobile port of web/pages/Agenda.jsx: everything with a date
 *  (open tasks, open checklist items, project targets), grouped by day. */
import { Pressable, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, FileText, FolderKanban, ListTodo } from 'lucide-react-native';
import { get } from '../src/lib/api';
import { todayOrg, useOrgId } from '../src/lib/org';
import { useTheme } from '../src/lib/theme';
import { Card, Chip, Empty, ErrorState, PageHeader, Screen, Skeleton } from '../src/components/ui';

const KIND = {
  task: { Icon: ListTodo, label: 'task' },
  checklist: { Icon: FolderKanban, label: 'checklist' },
  project: { Icon: FolderKanban, label: 'project due' },
  document: { Icon: FileText, label: 'paper' },
};

export default function Agenda() {
  const org = useOrgId();
  const router = useRouter();
  const { t } = useTheme();
  const today = todayOrg();

  const tasks = useQuery({
    queryKey: ['tasks', org, 'agenda'],
    queryFn: () => get(`/orgs/${org}/tasks?status=open&pageSize=100`),
    enabled: !!org,
  });
  const items = useQuery({
    queryKey: ['checklist-agenda', org],
    queryFn: () => get(`/orgs/${org}/checklist-items?done=false`),
    enabled: !!org,
  });
  const projects = useQuery({
    queryKey: ['projects', org],
    queryFn: () => get(`/orgs/${org}/projects?pageSize=100`),
    enabled: !!org,
  });

  const entries = [
    ...(tasks.data?.data ?? [])
      .filter((x) => x.due_date)
      .map((x) => ({ date: x.due_date, kind: 'task', label: x.title, sub: 'task', to: `/tasks?task=${x.id}` })),
    ...(items.data?.data ?? [])
      .filter((x) => x.due_date)
      .map((x) => ({ date: x.due_date, kind: 'checklist', label: x.label, sub: x.project_title, to: `/project/${x.project_id}` })),
    ...(projects.data?.data ?? [])
      .filter((p) => p.target_date && p.status !== 'done' && p.status !== 'cancelled')
      .map((p) => ({ date: p.target_date, kind: 'project', label: p.title, sub: 'project target', to: `/project/${p.id}` })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const byDay = entries.reduce((m, e) => { (m[e.date] ??= []).push(e); return m; }, {});
  const days = Object.keys(byDay).sort();
  const loading = tasks.isLoading || items.isLoading || projects.isLoading;
  const failed = tasks.error || items.error || projects.error;

  return (
    <Screen refresh={async () => { await Promise.all([tasks.refetch(), items.refetch(), projects.refetch()]); }}>
      <PageHeader
        title="Agenda"
        description="Everything with a date — task deadlines, checklist items, project targets — in order."
      />
      {loading ? <Skeleton style={{ height: 192 }} /> : null}
      {failed ? <ErrorState error={failed} what="your agenda" /> : null}
      {!loading && days.length === 0 ? (
        <Empty icon={<CalendarDays size={24} color={t.ink3} />} title="Nothing scheduled"
               hint="Due dates on tasks and checklist items, and project target dates, land here." />
      ) : null}
      {days.map((day) => (
        <Card key={day} style={{ gap: 2 }}>
          <Text style={{
            fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
            color: day === today ? t.brand : day < today ? t.alert : t.ink2,
          }}>
            {day === today ? `Today · ${day}` : day}
          </Text>
          {byDay[day].map((e, i) => {
            const meta = KIND[e.kind] ?? KIND.task;
            const late = e.date < today;
            return (
              <Pressable key={i} accessibilityRole="button" onPress={() => router.push(e.to)}
                         style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 6, borderRadius: t.radiusInput, minHeight: 44 }}>
                <meta.Icon size={15} color={t.ink3} />
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: t.ink }}>{e.label}</Text>
                <Text style={{ fontSize: 12, color: t.ink3 }}>{e.sub}</Text>
                {late ? <Chip kind="alert" label="Overdue" /> : null}
              </Pressable>
            );
          })}
        </Card>
      ))}
    </Screen>
  );
}
