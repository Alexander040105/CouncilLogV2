import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { ArrowLeft, UserCheck } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { atLeast, currentOrgId } from '../lib/org';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Card, Chip, Empty, Skeleton } from '../components/ui';

export default function ProjectDetail() {
  const { id } = useParams();
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const { active } = useOutletContext() ?? {};
  const canAssign = active ? atLeast(active.role, 'adviser') : false;

  const q = useQuery({
    queryKey: ['project', org, id],
    queryFn: () => get(`/orgs/${org}/projects/${id}`),
    enabled: !!org,
  });
  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members?pageSize=100`),
    enabled: !!org,
  });
  const activeMembers = members.data?.data.filter((m) => m.status === 'active') ?? [];
  const nameOf = (id) =>
    activeMembers.find((m) => m.user_id === id)?.display_name ?? null;
  const instantiate = useMutation({
    mutationFn: () => post(`/orgs/${org}/projects/${id}/instantiate`, {}),
    onSuccess: (r) => {
      toast.success(`Checklist generated — ${r.instantiated_items} item(s).`);
      qc.invalidateQueries({ queryKey: ['project', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });
  const check = useMutation({
    mutationFn: ({ itemId, done }) =>
      patch(`/orgs/${org}/checklist-items/${itemId}`, { done }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', org, id] }),
    onError: (e) => toast.error(e.message),
  });
  const assign = useMutation({
    mutationFn: ({ itemId, assignee_id }) =>
      patch(`/orgs/${org}/checklist-items/${itemId}`, { assignee_id }),
    onSuccess: (_r, v) => {
      toast.success(v.assignee_id ? 'Task assigned — they\'ll be emailed.' : 'Task unassigned.');
      qc.invalidateQueries({ queryKey: ['project', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-64" />;
  const p = q.data?.data;
  if (!p) return <Empty title="Project not found" />;
  const items = q.data?.checklist ?? [];

  return (
    <div className="space-y-4">
      <Link to="/projects" className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]">
        <ArrowLeft size={14} /> Projects
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{p.title}</h1>
        <div className="mt-1 flex flex-wrap gap-2">
          <Chip kind="neutral" label={p.status} />
          {p.event_type && <Chip kind="extra" label={p.event_type} />}
          {p.target_date && <Chip kind="pending" label={`target ${p.target_date}`} />}
        </div>
        {p.details && <p className="mt-2 text-sm text-[var(--color-ink-2)]">{p.details}</p>}
        {nameOf(p.owner_id) && (
          <div className="mt-1 flex items-center gap-1 text-xs text-[var(--color-ink-3)]">
            <UserCheck size={14} /> lead: {nameOf(p.owner_id)}
          </div>
        )}
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-[var(--color-ink-2)]">Checklist</div>
          {items.length === 0 && (
            <Button variant="secondary" onClick={() => instantiate.mutate()} disabled={instantiate.isPending}>
              {instantiate.isPending ? 'Generating…' : 'Generate checklist'}
            </Button>
          )}
        </div>
        {items.length === 0 && <Empty title="No checklist yet" hint="Generate one from your org's checklist templates." />}
        <div className="space-y-1">
          {items.map((it) => {
            const assignee = nameOf(it.assignee_id);
            const mine = it.assignee_id === session?.user?.id;
            return (
              <div key={it.id} className="flex items-start gap-3 rounded p-2 hover:bg-[var(--color-surface-3)]">
                <input
                  type="checkbox" checked={it.done} aria-label={`mark ${it.label} done`}
                  onChange={(e) => check.mutate({ itemId: it.id, done: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <span className="flex-1">
                  <span className={`text-sm ${it.done ? 'line-through text-[var(--color-ink-3)]' : ''}`}>{it.label}</span>
                  {it.hint && <span className="block text-xs text-[var(--color-ink-3)]">{it.hint}</span>}
                </span>
                {it.due_date && <Chip kind="pending" label={`due ${it.due_date}`} />}
                {canAssign ? (
                  <select
                    aria-label={`Assign ${it.label}`}
                    className="min-h-[36px] max-w-[8.5rem] rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 text-xs"
                    value={it.assignee_id ?? ''}
                    onChange={(e) => assign.mutate({ itemId: it.id, assignee_id: e.target.value || null })}
                  >
                    <option value="">unassigned</option>
                    {activeMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
                  </select>
                ) : assignee ? (
                  <Chip kind="neutral" label={mine ? 'you' : assignee} />
                ) : !it.done ? (
                  <button
                    className="min-h-[36px] rounded px-2 text-xs text-[var(--color-accent)]"
                    onClick={() => assign.mutate({ itemId: it.id, assignee_id: session?.user?.id })}
                  >
                    Take it
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
