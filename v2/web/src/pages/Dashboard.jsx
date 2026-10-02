import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router-dom';
import { Check, CalendarCheck, FileText, FolderKanban, ListTodo, Users } from 'lucide-react';
import { get } from '../lib/api';
import { currentOrgId, todayOrg } from '../lib/org';
import { Button, Card, Chip, Empty, ErrorState, HintBanner, PageHeader, Skeleton } from '../components/ui';

export default function Dashboard() {
  const { me } = useOutletContext();
  const org = currentOrgId();
  const today = todayOrg();

  const att = useQuery({
    queryKey: ['attendance', 'day', org, today],
    queryFn: () => get(`/orgs/${org}/attendance?day=${today}`),
    enabled: !!org,
  });
  const positions = useQuery({
    queryKey: ['positions', org],
    queryFn: () => get(`/orgs/${org}/positions`),
    enabled: !!org,
  });
  // "What needs you" — my open tasks + my open checklist items + papers
  // whose latest custody move was mine (still out for signatures).
  const myTasks = useQuery({
    queryKey: ['tasks', org, 'mine'],
    queryFn: () => get(`/orgs/${org}/tasks?assignee=me&status=open&pageSize=10`),
    enabled: !!org,
  });
  const myItems = useQuery({
    queryKey: ['checklist-mine', org],
    queryFn: () => get(`/orgs/${org}/checklist-items?assignee_id=${me?.id}&done=false`),
    enabled: !!org && !!me?.id,
  });
  const myPapers = useQuery({
    queryKey: ['documents', org, 'held-by-me'],
    queryFn: () => get(`/orgs/${org}/documents?held_by=me&pageSize=10`),
    enabled: !!org,
  });
  const needs = [
    ...(myTasks.data?.data ?? []).map((x) => ({
      id: `t-${x.id}`, label: x.title, to: `/tasks?task=${x.id}`,
      sub: x.due_date ? `Task · due ${x.due_date}` : 'Task',
      hot: x.due_date && x.due_date < today,
    })),
    ...(myItems.data?.data ?? []).map((x) => ({
      id: `i-${x.id}`, label: x.label, to: `/projects/${x.project_id}`,
      sub: x.due_date ? `${x.project_title} · due ${x.due_date}` : `Checklist · ${x.project_title}`,
      hot: x.due_date && x.due_date < today,
    })),
    ...(myPapers.data?.data ?? []).map((x) => ({
      id: `d-${x.id}`, label: x.title, to: `/documents/${x.id}`,
      sub: 'Paper in your custody', hot: x.status === 'revision',
    })),
  ];

  const myRow = att.data?.data.find((r) => r.member_id === me?.id);
  const isFresh =
    positions.data && positions.data.data.length === 0 &&
    att.data && att.data.data.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Today"
        description="Your duty day at a glance: file once, you're accounted."
      />

      <HintBanner id="dashboard">
        File a journal entry on your assigned day — or tap "No tasks today". That's all it
        takes to be counted present. Papers and projects live in their own tabs.
      </HintBanner>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-[var(--color-ink-3)]">Your day</div>
            <div className="text-lg font-semibold">
              {myRow ? (myRow.status === 'documented' ? 'Documented' : 'No tasks declared') : 'Nothing filed yet'}
            </div>
          </div>
          {myRow && (
            <Chip
              kind={myRow.status === 'documented' ? 'done' : 'neutral'}
              label={myRow.duty_type === 'extra' ? 'Extra duty' : 'On duty'}
              icon={<Check size={12} />}
            />
          )}
        </div>
        <div className="flex gap-2">
          <Link to="/journal?compose=1" className="flex-1"><Button className="w-full">Log work</Button></Link>
          <Link to="/journal?notasks=1" className="flex-1"><Button variant="secondary" className="w-full">No tasks today</Button></Link>
        </div>
      </Card>

      {isFresh && (
        <Card>
          <div className="label-strong mb-2 text-sm text-[var(--color-ink-2)]">New here? How CounciLog works</div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-2)]">
            <li>File a journal entry each duty day — that's your attendance.</li>
            <li><Link className="text-[var(--color-accent)]" to="/documents">Papers</Link> tracks where physical documents are and who's signing them.</li>
            <li><Link className="text-[var(--color-accent)]" to="/projects">Projects</Link> holds events and their paperwork + logistics checklists.</li>
            <li>Admins set up positions, duty days, and templates in <Link className="text-[var(--color-accent)]" to="/settings">Settings</Link>.</li>
          </ul>
        </Card>
      )}

      {(myTasks.isLoading || myItems.isLoading || myPapers.isLoading) && (
        <Card><Skeleton className="h-16" /></Card>
      )}
      {needs.length > 0 && (
        <Card>
          <div className="label-strong mb-2 flex items-center gap-1.5 text-sm text-[var(--color-ink-2)]">
            <ListTodo size={14} /> Needs you ({needs.length})
          </div>
          <div className="space-y-1">
            {needs.map((n) => (
              <Link key={n.id} to={n.to}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-input)] px-2 py-2 hover:bg-[var(--color-surface-3)]">
                <span className="min-w-0 truncate text-sm font-medium">{n.label}</span>
                <span className={`shrink-0 text-xs ${n.hot ? 'font-semibold text-[var(--color-status-alert)]' : 'text-[var(--color-ink-3)]'}`}>
                  {n.sub}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="label-strong mb-2 text-sm text-[var(--color-ink-2)]">Duty roster today</div>
        {att.isLoading && <Skeleton className="h-16" />}
        {att.isError && <ErrorState error={att.error} retry={att.refetch} />}
        {att.data && att.data.data.length === 0 && att.data.unaccounted_member_ids.length === 0 && (
          <Empty icon={<CalendarCheck size={24} />} title="No duty entries yet" hint="Be the first to file today." />
        )}
        {att.data && (att.data.data.length > 0 || att.data.unaccounted_member_ids.length > 0) && (
          <div className="space-y-1 text-sm">
            <div>{att.data.data.length} entries filed today</div>
            {att.data.unaccounted_member_ids.length > 0 && (
              <div className="text-[var(--color-status-alert)]">
                {att.data.unaccounted_member_ids.length} scheduled member(s) haven't filed yet
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="label-strong text-sm text-[var(--color-ink-2)]">Quick links</div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Link to="/projects"><Button variant="secondary" className="w-full"><FolderKanban size={16} />Projects</Button></Link>
          <Link to="/documents"><Button variant="secondary" className="w-full"><FileText size={16} />Papers</Button></Link>
          <Link to="/attendance"><Button variant="secondary" className="w-full"><CalendarCheck size={16} />Attendance</Button></Link>
          <Link to="/members"><Button variant="secondary" className="w-full"><Users size={16} />Org chart</Button></Link>
        </div>
      </Card>
    </div>
  );
}
