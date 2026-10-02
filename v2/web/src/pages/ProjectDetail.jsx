import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Pencil, Plus, Trash2, UserCheck } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { atLeast, currentOrgId } from '../lib/org';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { assigneeLabel, humanize, projectStatusLabel } from '../lib/labels';
import { Button, Card, Chip, ConfirmDialog, Empty, ErrorState, Field, Input, Sheet, Skeleton } from '../components/ui';
import { ChecklistPreview } from '../components/ChecklistPreview';
import { diagnoseChecklist, humanizeFlag } from '../lib/rules';

const STATUS_ORDER = ['draft', 'active', 'done', 'archived'];

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'open', label: 'Not done', test: (i) => !i.done },
  { id: 'done', label: 'Done', test: (i) => i.done },
  { id: 'assigned', label: 'Assigned', test: (i) => !!i.assignee_id },
  { id: 'unassigned', label: 'Unassigned', test: (i) => !i.assignee_id },
  { id: 'mine', label: 'Mine', test: (i, myId) => i.assignee_id === myId },
];

export default function ProjectDetail() {
  const { id } = useParams();
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const { active } = useOutletContext() ?? {};
  const myId = session?.user?.id;
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
  const [filter, setFilter] = useState('all');
  const [editItem, setEditItem] = useState(null);     // item object, or 'new'
  const [delItem, setDelItem] = useState(null);
  const [pendingStatus, setPendingStatus] = useState(null);
  const [itemForm, setItemForm] = useState({ label: '', hint: '', due_date: '', required: true });
  const activeMembers = members.data?.data.filter((m) => m.status === 'active') ?? [];
  const nameOf = (id) =>
    activeMembers.find((m) => m.user_id === id)?.display_name ?? null;

  const reload = () => qc.invalidateQueries({ queryKey: ['project', org, id] });
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
      reload();
    },
    onError: (e) => {
      toast.error(e.message);
      // ALREADY_INSTANTIATED → refetch so the existing checklist shows
      reload();
    },
  });
  const check = useMutation({
    mutationFn: ({ itemId, done }) =>
      patch(`/orgs/${org}/checklist-items/${itemId}`, { done }),
    onSuccess: reload,
    onError: (e) => toast.error(e.message),
  });
  const assign = useMutation({
    mutationFn: ({ itemId, assignee_id }) =>
      patch(`/orgs/${org}/checklist-items/${itemId}`, { assignee_id }),
    onSuccess: (_r, v) => {
      toast.success(v.assignee_id ? 'Task assigned — they\'ll be emailed.' : 'Task unassigned.');
      reload();
    },
    onError: (e) => toast.error(e.message),
  });
  const setStatus = useMutation({
    mutationFn: (status) => patch(`/orgs/${org}/projects/${id}`, { status }),
    onSuccess: (_r, v) => {
      toast.success(`Project marked ${projectStatusLabel(v).toLowerCase()}.`);
      setPendingStatus(null);
      reload();
      qc.invalidateQueries({ queryKey: ['projects', org] });
    },
    onError: (e) => toast.error(e.message),
  });
  const saveItem = useMutation({
    mutationFn: () => {
      const body = {
        label: itemForm.label.trim(),
        hint: itemForm.hint.trim() || null,
        due_date: itemForm.due_date || null,
        required: itemForm.required,
      };
      return editItem === 'new'
        ? post(`/orgs/${org}/projects/${id}/checklist-items`, body)
        : patch(`/orgs/${org}/checklist-items/${editItem.id}`, body);
    },
    onSuccess: () => {
      toast.success(editItem === 'new' ? 'Item added.' : 'Item updated.');
      setEditItem(null);
      reload();
    },
    onError: (e) => toast.error(e.message),
  });
  const removeItem = useMutation({
    mutationFn: (itemId) => del(`/orgs/${org}/checklist-items/${itemId}`),
    onSuccess: () => {
      toast.success('Item removed.');
      setDelItem(null);
      reload();
    },
    onError: (e) => { setDelItem(null); toast.error(e.message); },
  });
  const reorder = useMutation({
    mutationFn: (itemIds) =>
      post(`/orgs/${org}/projects/${id}/checklist-items/reorder`, { item_ids: itemIds }),
    onSuccess: reload,
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const p = q.data?.data;
  if (!p) return <Empty title="Project not found" />;

  const isLead = p.owner_id === myId;
  const canStructure = canAssign || isLead;   // adviser+ or the project lead
  const canMoveStatus = canAssign || isLead;

  const items = q.data?.checklist ?? [];
  const diag = diagnoseChecklist(templates.data?.data, {
    paper: p.needs_paper_processing, logistics: p.needs_logistics,
    eventType: p.event_type, flags: p.flags ?? {}, targetDate: p.target_date,
  });
  const flagNames = Object.entries(p.flags ?? {}).filter(([, v]) => v).map(([k]) => k);

  const shown = items.filter((i) => FILTERS.find((f) => f.id === filter)?.test(i, myId));
  const moveItem = (idx, dir) => {
    const ids = items.map((i) => i.id);
    [ids[idx], ids[idx + dir]] = [ids[idx + dir], ids[idx]];
    reorder.mutate(ids);
  };
  const openEditItem = (it) => {
    setEditItem(it);
    setItemForm({ label: it.label, hint: it.hint ?? '', due_date: it.due_date ?? '', required: it.required });
  };
  const openNewItem = () => {
    setEditItem('new');
    setItemForm({ label: '', hint: '', due_date: '', required: true });
  };
  const askStatus = (v) => {
    if (v === p.status) return;
    if (v === 'done' || v === 'archived') setPendingStatus(v);
    else setStatus.mutate(v);
  };

  return (
    <div className="space-y-4">
      <Link to="/projects" className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]">
        <ArrowLeft size={14} /> Projects
      </Link>
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="heading-strong min-w-0 text-2xl">{p.title}</h1>
          {canMoveStatus && (
            <label className="flex items-center gap-2 text-xs text-[var(--color-ink-3)]">
              Status
              <select
                aria-label="Project status"
                className="min-h-[36px] rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-2 text-sm"
                value={p.status}
                disabled={setStatus.isPending}
                onChange={(e) => askStatus(e.target.value)}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{projectStatusLabel(s)}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          <Chip kind="neutral" label={projectStatusLabel(p.status)} />
          {p.event_type && <Chip kind="extra" label={humanize(p.event_type)} />}
          {p.target_date && <Chip kind="pending" label={`Target ${p.target_date}`} />}
          {flagNames.map((f) => <Chip key={f} kind="neutral" label={humanizeFlag(f)} />)}
        </div>
        {p.details && <p className="mt-2 text-sm text-[var(--color-ink-2)]">{p.details}</p>}
        {nameOf(p.owner_id) && (
          <div className="mt-1 flex items-center gap-1 text-xs text-[var(--color-ink-3)]">
            <UserCheck size={14} /> Lead: {nameOf(p.owner_id)}
          </div>
        )}
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="label-strong text-sm text-[var(--color-ink-2)]">Checklist</div>
          <div className="flex flex-wrap items-center gap-2">
            {items.length === 0 && diag.reason === 'ok' && (
              <Button variant="secondary" onClick={() => instantiate.mutate()} disabled={instantiate.isPending}>
                {instantiate.isPending ? 'Generating…' : `Generate checklist — ${diag.items.length} items`}
              </Button>
            )}
            {canStructure && items.length > 0 && (
              <Button variant="secondary" className="min-h-[36px] px-3 text-xs" onClick={openNewItem}>
                <Plus size={14} /> Add item
              </Button>
            )}
          </div>
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
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="Template to generate from"
                    className="min-h-[44px] min-w-0 flex-1 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
                    value={pickTemplate} onChange={(e) => setPickTemplate(e.target.value)}
                  >
                    <option value="">Choose a template…</option>
                    {templates.data.data.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} · {humanize(t.track)}{t.event_type ? ` · ${humanize(t.event_type)}` : ''}</option>
                    ))}
                  </select>
                  <Button variant="secondary" disabled={!pickTemplate || instantiate.isPending}
                          onClick={() => setConfirmPick(true)}>
                    Generate
                  </Button>
                </div>
              </div>
            )}
            {canStructure && (
              <Button variant="secondary" className="min-h-[38px] w-full text-xs" onClick={openNewItem}>
                <Plus size={14} /> Add the first item by hand
              </Button>
            )}
          </div>
        )}
        {!canCheck && items.length > 0 && (
          <p className="mb-2 text-xs text-[var(--color-ink-3)]">
            View only — officers tick checklist items off.
          </p>
        )}
        {items.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter checklist">
            {FILTERS.map((f) => {
              const n = items.filter((i) => f.test(i, myId)).length;
              if (f.id === 'mine' && n === 0) return null;
              const on = filter === f.id;
              return (
                <button
                  key={f.id}
                  aria-pressed={on}
                  onClick={() => setFilter(f.id)}
                  className={`min-h-[32px] rounded-[var(--chip-radius)] px-2.5 text-xs label-strong [border:var(--border-box)] ${
                    on ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)]'
                       : 'bg-[var(--color-surface-2)] text-[var(--color-ink-2)] hover:bg-[var(--color-surface-3)]'}`}
                >
                  {f.label} · {n}
                </button>
              );
            })}
          </div>
        )}
        <div className="space-y-1">
          {shown.length === 0 && items.length > 0 && (
            <p className="p-2 text-xs text-[var(--color-ink-3)]">
              Nothing matches this filter — pick another one above.
            </p>
          )}
          {shown.map((it) => {
            const assignee = nameOf(it.assignee_id);
            const idx = items.indexOf(it);
            return (
              <div key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-input)] p-2 hover:bg-[var(--color-surface-3)]">
                <input
                  type="checkbox" checked={it.done} aria-label={`Mark ${it.label} done`}
                  disabled={!canCheck || check.isPending}
                  onChange={(e) => check.mutate({ itemId: it.id, done: e.target.checked })}
                  className="h-4 w-4 shrink-0 disabled:opacity-50"
                />
                <span className="min-w-0 flex-1 basis-40">
                  <span className={`block text-sm ${it.done ? 'line-through text-[var(--color-ink-3)]' : ''}`}>
                    {it.label}
                    {!it.required && <span className="ml-1 text-xs text-[var(--color-ink-3)]">(optional)</span>}
                  </span>
                  {it.hint && <span className="block text-xs text-[var(--color-ink-3)]">{it.hint}</span>}
                </span>
                {it.due_date && <Chip kind="pending" label={`Due ${it.due_date}`} />}
                {canAssign ? (
                  <select
                    aria-label={`Assign ${it.label}`}
                    className="min-h-[36px] max-w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-1.5 text-xs sm:max-w-[10rem]"
                    value={it.assignee_id ?? ''}
                    onChange={(e) => assign.mutate({ itemId: it.id, assignee_id: e.target.value || null })}
                  >
                    <option value="">Unassigned</option>
                    {activeMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
                  </select>
                ) : assignee ? (
                  <Chip kind="neutral" label={it.assignee_id === myId ? 'You' : assignee} />
                ) : !it.done && canCheck ? (
                  <button
                    className="min-h-[36px] rounded-[var(--radius-input)] px-2 text-xs text-[var(--color-accent)]"
                    onClick={() => assign.mutate({ itemId: it.id, assignee_id: myId })}
                  >
                    Take it
                  </button>
                ) : null}
                {canStructure && (
                  <span className="flex items-center">
                    {filter === 'all' && (
                      <>
                        <button aria-label={`Move ${it.label} up`} disabled={idx === 0 || reorder.isPending}
                                className="min-h-[32px] min-w-[32px] text-[var(--color-ink-3)] disabled:opacity-30"
                                onClick={() => moveItem(idx, -1)}><ArrowUp size={14} className="mx-auto" /></button>
                        <button aria-label={`Move ${it.label} down`} disabled={idx === items.length - 1 || reorder.isPending}
                                className="min-h-[32px] min-w-[32px] text-[var(--color-ink-3)] disabled:opacity-30"
                                onClick={() => moveItem(idx, 1)}><ArrowDown size={14} className="mx-auto" /></button>
                      </>
                    )}
                    <button aria-label={`Edit ${it.label}`}
                            className="min-h-[32px] min-w-[32px] text-[var(--color-ink-3)]"
                            onClick={() => openEditItem(it)}><Pencil size={14} className="mx-auto" /></button>
                    <button aria-label={`Remove ${it.label}`}
                            className="min-h-[32px] min-w-[32px] text-[var(--color-status-alert)]"
                            onClick={() => setDelItem(it)}><Trash2 size={14} className="mx-auto" /></button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Sheet open={!!editItem} onClose={() => setEditItem(null)}
             title={editItem === 'new' ? 'Add checklist item' : 'Edit checklist item'}>
        <div className="space-y-3">
          <Field label="What needs doing?">
            <Input autoFocus value={itemForm.label}
                   onChange={(e) => setItemForm({ ...itemForm, label: e.target.value })} />
          </Field>
          <Field label="Hint (optional)">
            <Input value={itemForm.hint}
                   onChange={(e) => setItemForm({ ...itemForm, hint: e.target.value })} />
          </Field>
          <Field label="Due date (optional)">
            <Input type="date" value={itemForm.due_date}
                   onChange={(e) => setItemForm({ ...itemForm, due_date: e.target.value })} />
          </Field>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={itemForm.required}
                   onChange={(e) => setItemForm({ ...itemForm, required: e.target.checked })} />
            Required — the project isn't done until this is
          </label>
          <Button className="w-full" disabled={!itemForm.label.trim() || saveItem.isPending}
                  onClick={() => saveItem.mutate()}>
            {saveItem.isPending ? 'Saving…' : editItem === 'new' ? 'Add item' : 'Save changes'}
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={!!delItem} onClose={() => setDelItem(null)}
        onConfirm={() => removeItem.mutate(delItem.id)}
        busy={removeItem.isPending}
        title="Remove this checklist item?"
        body={`"${delItem?.label}" leaves the checklist. This is logged — anyone can see it was removed.`}
        confirmLabel="Remove item"
      />
      <ConfirmDialog
        open={!!pendingStatus} onClose={() => setPendingStatus(null)} danger={false}
        onConfirm={() => setStatus.mutate(pendingStatus)}
        busy={setStatus.isPending}
        title={`Mark project ${pendingStatus}?`}
        body={pendingStatus === 'done'
          ? 'Done projects stay visible on the board — you can still reopen it.'
          : 'Archived projects drop off the board but keep their history — you can bring it back anytime.'}
        confirmLabel={pendingStatus === 'done' ? 'Mark done' : 'Archive'}
      />
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
