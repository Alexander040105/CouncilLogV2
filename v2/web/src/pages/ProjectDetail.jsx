import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { ArrowLeft, UserCheck } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { atLeast, currentOrgId } from '../lib/org';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Card, Chip, ConfirmDialog, Empty, ErrorState, Skeleton } from '../components/ui';
import { ChecklistPreview } from '../components/ChecklistPreview';
import { diagnoseChecklist, humanizeFlag } from '../lib/rules';

export default function ProjectDetail() {
  const { id } = useParams();
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const { active } = useOutletContext() ?? {};
  const canAssign = active ? atLeast(active.role, 'adviser') : false;
  const canCheck = active ? atLeast(active.role, 'officer') : false;

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
  const templates = useQuery({
    queryKey: ['templates', org],
    queryFn: () => get(`/orgs/${org}/checklist-templates`),
    enabled: !!org,
  });
  const [pickTemplate, setPickTemplate] = useState('');
  const [confirmPick, setConfirmPick] = useState(false);
  const activeMembers = members.data?.data.filter((m) => m.status === 'active') ?? [];
  const nameOf = (id) =>
    activeMembers.find((m) => m.user_id === id)?.display_name ?? null;
  const instantiate = useMutation({
    mutationFn: ({ templateIds, append } = {}) =>
      post(`/orgs/${org}/projects/${id}/instantiate`,
        templateIds?.length ? { template_ids: templateIds, append } : {}),
    onSuccess: (r) => {
      setConfirmPick(false); setPickTemplate('');
      if (r.instantiated_items > 0) {
        toast.success(`Checklist generated — ${r.instantiated_items} item(s).`);
      } else {
        toast.error('Nothing generated — see the checklist card for why.');
      }
      qc.invalidateQueries({ queryKey: ['project', org, id] });
    },
    onError: (e) => {
      toast.error(e.message);
      // ALREADY_INSTANTIATED → refetch so the existing checklist shows
      qc.invalidateQueries({ queryKey: ['project', org, id] });
    },
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
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const p = q.data?.data;
  if (!p) return <Empty title="Project not found" />;
  const items = q.data?.checklist ?? [];
  const diag = diagnoseChecklist(templates.data?.data, {
    paper: p.needs_paper_processing, logistics: p.needs_logistics,
    eventType: p.event_type, flags: p.flags ?? {}, targetDate: p.target_date,
  });
  const flagNames = Object.entries(p.flags ?? {}).filter(([, v]) => v).map(([k]) => k);

  return (
    <div className="space-y-4">
      <Link to="/projects" className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]">
        <ArrowLeft size={14} /> Projects
      </Link>
      <div>
        <h1 className="heading-strong text-2xl">{p.title}</h1>
        <div className="mt-1 flex flex-wrap gap-2">
          <Chip kind="neutral" label={p.status} />
          {p.event_type && <Chip kind="extra" label={p.event_type} />}
          {p.target_date && <Chip kind="pending" label={`target ${p.target_date}`} />}
          {flagNames.map((f) => <Chip key={f} kind="neutral" label={humanizeFlag(f)} />)}
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
          <div className="label-strong text-sm text-[var(--color-ink-2)]">Checklist</div>
          {items.length === 0 && diag.reason === 'ok' && (
            <Button variant="secondary" onClick={() => instantiate.mutate()} disabled={instantiate.isPending}>
              {instantiate.isPending ? 'Generating…' : `Generate checklist — ${diag.items.length} items`}
            </Button>
          )}
        </div>
        {items.length === 0 && (
          <div className="space-y-3">
            <ChecklistPreview
              templates={templates.data?.data}
              paper={p.needs_paper_processing} logistics={p.needs_logistics}
              eventType={p.event_type} flags={p.flags ?? {}}
              targetDate={p.target_date} />
            {diag.reason !== 'ok' && diag.reason !== 'no_needs'
              && (templates.data?.data.length ?? 0) > 0 && canAssign && (
              <div className="space-y-1.5">
                <div className="text-xs text-[var(--color-ink-3)]">
                  Or force it — pick a template directly:
                </div>
                <div className="flex gap-2">
                  <select
                    aria-label="Template to generate from"
                    className="min-h-[44px] flex-1 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
                    value={pickTemplate} onChange={(e) => setPickTemplate(e.target.value)}
                  >
                    <option value="">choose a template…</option>
                    {templates.data.data.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} · {t.track}{t.event_type ? ` · ${t.event_type}` : ''}</option>
                    ))}
                  </select>
                  <Button variant="secondary" disabled={!pickTemplate || instantiate.isPending}
                          onClick={() => setConfirmPick(true)}>
                    Generate
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {!canCheck && items.length > 0 && (
          <p className="mb-2 text-xs text-[var(--color-ink-3)]">
            View only — officers tick checklist items off.
          </p>
        )}
        <div className="space-y-1">
          {items.map((it) => {
            const assignee = nameOf(it.assignee_id);
            const mine = it.assignee_id === session?.user?.id;
            return (
              <div key={it.id} className="flex items-start gap-3 rounded-[var(--radius-input)] p-2 hover:bg-[var(--color-surface-3)]">
                <input
                  type="checkbox" checked={it.done} aria-label={`mark ${it.label} done`}
                  disabled={!canCheck || check.isPending}
                  onChange={(e) => check.mutate({ itemId: it.id, done: e.target.checked })}
                  className="mt-1 h-4 w-4 disabled:opacity-50"
                />
                <span className="flex-1">
                  <span className={`text-sm ${it.done ? 'line-through text-[var(--color-ink-3)]' : ''}`}>{it.label}</span>
                  {it.hint && <span className="block text-xs text-[var(--color-ink-3)]">{it.hint}</span>}
                </span>
                {it.due_date && <Chip kind="pending" label={`due ${it.due_date}`} />}
                {canAssign ? (
                  <select
                    aria-label={`Assign ${it.label}`}
                    className="min-h-[36px] max-w-[8.5rem] rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-1.5 text-xs"
                    value={it.assignee_id ?? ''}
                    onChange={(e) => assign.mutate({ itemId: it.id, assignee_id: e.target.value || null })}
                  >
                    <option value="">unassigned</option>
                    {activeMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
                  </select>
                ) : assignee ? (
                  <Chip kind="neutral" label={mine ? 'you' : assignee} />
                ) : !it.done && canCheck ? (
                  <button
                    className="min-h-[36px] rounded-[var(--radius-input)] px-2 text-xs text-[var(--color-accent)]"
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
      <ConfirmDialog
        open={confirmPick} onClose={() => setConfirmPick(false)}
        onConfirm={() => instantiate.mutate({ templateIds: [pickTemplate], append: true })}
        busy={instantiate.isPending}
        title="Force-generate from this template?"
        body="This template doesn't auto-match the project — its items will be added on top of anything already generated."
        confirmLabel="Generate anyway"
      />
    </div>
  );
}
