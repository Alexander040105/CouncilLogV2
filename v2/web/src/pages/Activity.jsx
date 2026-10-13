import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity as ActivityIcon, ListTodo, MessageSquare, NotebookPen } from 'lucide-react';
import { get } from '../lib/api';
import { currentOrgId } from '../lib/org';
import { Chip, Empty, ErrorState, PageHeader, Skeleton } from '../components/ui';

/** One stream for "what's everyone doing" — dailies and tasks interleaved by
 *  when they were created. Dailies link to the Journal (comments live there),
 *  tasks to the Tasks page where they open. */
const FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'journal', label: 'Dailies' },
  { id: 'task', label: 'Tasks' },
];

export default function Activity() {
  const org = currentOrgId();
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

  const items = [
    ...(journal.data?.data ?? []).map((e) => ({
      kind: 'journal', id: `j-${e.id}`, at: e.created_at, entry: e,
    })),
    ...(tasks.data?.data ?? []).map((t) => ({
      kind: 'task', id: `t-${t.id}`, at: t.created_at, task: t,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))
   .filter((i) => filter === 'all' || i.kind === filter);

  const loading = journal.isLoading || tasks.isLoading;
  const failed = journal.isError ? journal : tasks.isError ? tasks : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activity"
        description="Everything the org is doing — dailies people logged and tasks created, in one stream."
      />

      <div className="flex flex-wrap gap-1 rounded-[var(--radius-input)] [border:var(--border-box)] p-0.5 text-sm">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
                  className={`label-strong min-h-[36px] rounded-[var(--radius-input)] px-3 py-1 ${filter === f.id ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]' : 'text-[var(--color-ink-3)]'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading && <Skeleton className="h-48" />}
      {failed && <ErrorState error={failed.error} retry={failed.refetch} />}
      {!loading && !failed && items.length === 0 && (
        <Empty icon={<ActivityIcon size={24} />} title="Nothing yet"
               hint="Dailies people log and tasks created will show up here."
               action={<Link to="/journal" className="text-[var(--color-accent)] underline">Log today's work</Link>} />
      )}

      <div className="space-y-2">
        {items.map((i) => i.kind === 'journal' ? (
          <Link key={i.id} to={i.entry.task_id ? `/journal?task=${i.entry.task_id}` : '/journal'}
                className="block">
            <div className="flex items-start gap-3 rounded-[var(--radius-card)] [border:var(--border-box)] bg-[var(--color-surface-2)] p-3 hover:bg-[var(--color-surface-3)]">
              <NotebookPen size={18} className="mt-0.5 shrink-0 text-[var(--color-brand)]" />
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <b>{nameOf(i.entry.member_id)}</b> logged a daily
                  {i.entry.task_title ? <> on <b>{i.entry.task_title}</b></> : null}
                </div>
                <div className="line-clamp-2 text-xs text-[var(--color-ink-2)]">{i.entry.description}</div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--color-ink-3)]">
                  {i.entry.entry_date}
                  {i.entry.comment_count > 0 && (
                    <span className="flex items-center gap-0.5"><MessageSquare size={10} />{i.entry.comment_count}</span>
                  )}
                </div>
              </div>
            </div>
          </Link>
        ) : (
          <Link key={i.id} to="/tasks" className="block">
            <div className="flex items-start gap-3 rounded-[var(--radius-card)] [border:var(--border-box)] bg-[var(--color-surface-2)] p-3 hover:bg-[var(--color-surface-3)]">
              <ListTodo size={18} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <b>{nameOf(i.task.creator_id)}</b> created a task — <b>{i.task.title}</b>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[var(--color-ink-3)]">
                  <Chip kind={i.task.status === 'done' ? 'done' : 'pending'} label={i.task.status} />
                  {(i.task.assignee_ids ?? (i.task.assignee_id ? [i.task.assignee_id] : [])).length > 0 && (
                    <span>→ {(i.task.assignee_ids ?? [i.task.assignee_id]).map(nameOf).join(', ')}</span>
                  )}
                  {i.task.due_date && <span>due {i.task.due_date}</span>}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
