import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, FileText, FolderKanban, ListTodo } from 'lucide-react';
import { get } from '../lib/api';
import { currentOrgId, todayOrg } from '../lib/org';
import { Card, Chip, Empty, ErrorState, PageHeader, Skeleton } from '../components/ui';

const KIND = {
  task: { Icon: ListTodo, chip: 'pending', label: 'task' },
  checklist: { Icon: FolderKanban, chip: 'neutral', label: 'checklist' },
  project: { Icon: FolderKanban, chip: 'neutral', label: 'project due' },
  document: { Icon: FileText, chip: 'skip', label: 'paper' },
};

/** One dated line in the agenda. */
function Row({ item, today }) {
  const meta = KIND[item.kind] ?? KIND.task;
  const late = item.date < today;
  return (
    <Link to={item.to} className="flex items-center gap-3 rounded-[var(--radius-input)] px-2 py-2 hover:bg-[var(--color-surface-3)]">
      <meta.Icon size={15} className="shrink-0 text-[var(--color-ink-3)]" />
      <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
      <span className="shrink-0 text-xs text-[var(--color-ink-3)]">{item.sub}</span>
      {late && <Chip kind="alert" label="overdue" />}
    </Link>
  );
}

/** Agenda — everything with a date on it, org-wide, grouped by day.
 *  Sources: open tasks (due_date), open checklist items (due_date),
 *  projects (target_date). Sorted soonest-first; today shows first. */
export default function Agenda() {
  const org = currentOrgId();
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
      .filter((t) => t.due_date)
      .map((t) => ({ date: t.due_date, kind: 'task', label: t.title, sub: 'task', to: `/tasks?task=${t.id}` })),
    ...(items.data?.data ?? [])
      .filter((i) => i.due_date)
      .map((i) => ({ date: i.due_date, kind: 'checklist', label: i.label, sub: i.project_title, to: `/projects/${i.project_id}` })),
    ...(projects.data?.data ?? [])
      .filter((p) => p.target_date && p.status !== 'done' && p.status !== 'cancelled')
      .map((p) => ({ date: p.target_date, kind: 'project', label: p.title, sub: 'project target', to: `/projects/${p.id}` })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const byDay = entries.reduce((m, e) => { (m[e.date] ??= []).push(e); return m; }, {});
  const days = Object.keys(byDay).sort();
  const loading = tasks.isLoading || items.isLoading || projects.isLoading;
  const failed = tasks.error || items.error || projects.error;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agenda"
        description="Everything with a date — task deadlines, checklist items, project targets — in order."
      />
      {loading && <Skeleton className="h-48" />}
      {failed && <ErrorState error={failed} />}
      {!loading && days.length === 0 && (
        <Empty icon={<CalendarDays size={24} />} title="Nothing scheduled"
               hint="Due dates on tasks and checklist items, and project target dates, land here." />
      )}
      {days.map((day) => (
        <Card key={day} className="space-y-1">
          <div className={`label-strong mb-1 text-xs ${day === today ? 'text-[var(--color-accent)]' : day < today ? 'text-[var(--color-status-alert)]' : 'text-[var(--color-ink-2)]'}`}>
            {day === today ? `Today · ${day}` : day}
          </div>
          {byDay[day].map((e, i) => <Row key={i} item={e} today={today} />)}
        </Card>
      ))}
    </div>
  );
}
