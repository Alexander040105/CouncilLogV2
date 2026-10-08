import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2, Circle, FileText, FolderKanban, ListTodo, NotebookPen,
  Plus, Trash2,
} from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { atLeast, currentOrgId } from '../lib/org';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { assigneeLabel, taskStatusLabel } from '../lib/labels';
import {
  Button, Card, Chip, ConfirmDialog, Empty, ErrorState, Field, Input,
  MemberMultiSelect, PageHeader, Sheet, Skeleton,
} from '../components/ui';

const FILTERS = [
  { id: 'mine', label: 'Assigned to me' },
  { id: 'by-me', label: 'I assigned' },
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
];

const PRIORITY_CHIP = { high: 'alert', normal: 'neutral', low: 'skip' };
const STATUS_CHIP = { open: 'pending', done: 'done', cancelled: 'skip' };

function overdue(t) {
  return t.status === 'open' && t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
}

/** Entity the task points at — one chip per link, each navigates to it. */
function LinkChips({ t, projects }) {
  const proj = t.project_id ? projects?.find((p) => p.id === t.project_id) : null;
  const link = 'inline-flex hover:underline';
  return (
    <span className="flex flex-wrap gap-1">
      {t.project_id && (
        <Link to={`/projects/${t.project_id}`} className={link}
              onClick={(e) => e.stopPropagation()}>
          <Chip kind="neutral" icon={<FolderKanban size={11} />}
                label={proj ? proj.title : 'Project'} />
        </Link>
      )}
      {t.document_id && (
        <Link to={`/documents/${t.document_id}`} className={link}
              onClick={(e) => e.stopPropagation()}>
          <Chip kind="neutral" icon={<FileText size={11} />} label="Document" />
        </Link>
      )}
      {t.journal_entry_id && (
        <Link to="/journal" className={link} onClick={(e) => e.stopPropagation()}>
          <Chip kind="neutral" icon={<NotebookPen size={11} />} label="Journal" />
        </Link>
      )}
    </span>
  );
}

/** Create/edit form — shared between the new-task sheet and detail edit. */
function TaskForm({ form, setForm, members, projects, documents, journals }) {
  const sel = 'min-h-[44px] w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm';
  return (
    <div className="space-y-3">
      <Field label="Task"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Print the tarpaulin" /></Field>
      <Field label="Details (optional)">
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3} placeholder="What done looks like, where the files are…"
                  className="w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]" />
      </Field>
      <Field label="Assign to" hint="Pick one or more people — each gets an in-app notification, an email, and a push ping.">
        <MemberMultiSelect members={members} value={form.assignee_ids}
                           onChange={(ids) => setForm({ ...form, assignee_ids: ids })}
                           placeholder="Unassigned" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Due (optional)"><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
        <Field label="Priority">
          <select className={sel} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </Field>
      </div>
      <Field label="Link to (optional)" hint="Point the task at the work it belongs to.">
        <div className="space-y-2">
          <select className={sel} value={form.project_id}
                  onChange={(e) => setForm({ ...form, project_id: e.target.value || null })}>
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <select className={sel} value={form.document_id}
                  onChange={(e) => setForm({ ...form, document_id: e.target.value || null })}>
            <option value="">No document</option>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <select className={sel} value={form.journal_entry_id}
                  onChange={(e) => setForm({ ...form, journal_entry_id: e.target.value || null })}>
            <option value="">No journal entry</option>
            {journals.map((j) => (
              <option key={j.id} value={j.id}>
                {j.entry_date} — {j.description.slice(0, 40)}{j.description.length > 40 ? '…' : ''}
              </option>
            ))}
          </select>
        </div>
      </Field>
    </div>
  );
}

const BLANK = { title: '', description: '', assignee_ids: [], due_date: '', priority: 'normal', project_id: '', document_id: '', journal_entry_id: '' };

export default function Tasks() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const { active } = useOutletContext() ?? {};
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('mine');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [comment, setComment] = useState('');

  const myId = session?.user?.id;
  const isOwner = active ? atLeast(active.role, 'owner') : false;
  const focusId = params.get('task');

  const tasks = useQuery({
    queryKey: ['tasks', org],
    queryFn: () => get(`/orgs/${org}/tasks?pageSize=100`),
    enabled: !!org,
  });
  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members?pageSize=100`),
    enabled: !!org,
  });
  const projects = useQuery({
    queryKey: ['projects', org],
    queryFn: () => get(`/orgs/${org}/projects?pageSize=100`),
    enabled: !!org,
  });
  const documents = useQuery({
    queryKey: ['documents', org],
    queryFn: () => get(`/orgs/${org}/documents?pageSize=100`),
    enabled: !!org,
  });
  const journals = useQuery({
    queryKey: ['journal-recent', org],
    queryFn: () => get(`/orgs/${org}/journal?pageSize=20`),
    enabled: !!org,
  });
  const detail = useQuery({
    queryKey: ['task', org, focusId],
    queryFn: () => get(`/orgs/${org}/tasks/${focusId}`),
    enabled: !!org && !!focusId,
  });

  const activeMembers = useMemo(
    () => members.data?.data.filter((m) => m.status === 'active') ?? [],
    [members.data]);
  const nameOf = (id) =>
    assigneeLabel(id, myId,
      (x) => members.data?.data.find((m) => m.user_id === x)?.display_name);
  const namesOf = (ids) => {
    if (!ids?.length) return 'Unassigned';
    const names = ids.map(nameOf);
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tasks', org] });
    qc.invalidateQueries({ queryKey: ['task', org] });
  };

  const create = useMutation({
    mutationFn: () => post(`/orgs/${org}/tasks`, {
      title: form.title, description: form.description || null,
      assignee_ids: form.assignee_ids, due_date: form.due_date || null,
      priority: form.priority, project_id: form.project_id || null,
      document_id: form.document_id || null,
      journal_entry_id: form.journal_entry_id || null,
    }),
    onSuccess: () => {
      toast.success(form.assignee_ids.length ? 'Task created — assignees notified.' : 'Task created.');
      setCreateOpen(false); setForm(BLANK); invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: (patchBody) => patch(`/orgs/${org}/tasks/${focusId}`, patchBody),
    onSuccess: () => { toast.success('Saved.'); invalidate(); detail.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => del(`/orgs/${org}/tasks/${focusId}`),
    onSuccess: () => {
      toast.success('Task deleted.'); setConfirmDelete(false);
      closeDetail(); invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const addComment = useMutation({
    mutationFn: () => post(`/orgs/${org}/tasks/${focusId}/comments`, { body: comment }),
    onSuccess: () => { setComment(''); detail.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const closeDetail = () => { params.delete('task'); setParams(params, { replace: true }); };
  const t = detail.data?.data;
  const canEditTask = t ? (String(t.creator_id) === myId || isOwner) : false;
  const assigneesOf = (x) => x?.assignee_ids ?? (x?.assignee_id ? [x.assignee_id] : []);
  const isAssignee = t ? assigneesOf(t).includes(myId) : false;

  // prefill the edit form from the opened task
  useEffect(() => {
    if (!t) return;
    setForm({
      title: t.title, description: t.description ?? '',
      assignee_ids: assigneesOf(t), due_date: t.due_date ?? '',
      priority: t.priority, project_id: t.project_id ?? '',
      document_id: t.document_id ?? '', journal_entry_id: t.journal_entry_id ?? '',
    });
  }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = tasks.data?.data ?? [];
  const filtered = list.filter((x) => {
    if (filter === 'mine') return assigneesOf(x).includes(myId) && x.status === 'open';
    if (filter === 'by-me') return String(x.creator_id) === myId;
    if (filter === 'open') return x.status === 'open';
    if (filter === 'done') return x.status === 'done';
    return true;
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tasks"
        description="To-dos between people — assign one and they're notified."
        action={<Button onClick={() => { setForm(BLANK); setCreateOpen(true); }}><Plus size={16} />New task</Button>}
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`label-strong min-h-[36px] rounded-[var(--chip-radius)] px-3 text-xs [border:var(--border-el)] ${filter === f.id ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-2)]'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {tasks.isLoading && <Skeleton className="h-48" />}
      {tasks.isError && <ErrorState error={tasks.error} retry={tasks.refetch} />}
      {tasks.isSuccess && filtered.length === 0 && (
        <Empty
          icon={<ListTodo size={24} />}
          title={filter === 'mine' ? 'Nothing assigned to you' : 'No tasks here'}
          hint={filter === 'mine'
            ? 'When someone assigns you a task it lands here — and you get notified.'
            : 'Create a task and assign it to someone in the org.'}
          action={<Button onClick={() => { setForm(BLANK); setCreateOpen(true); }}>New task</Button>}
        />
      )}

      <div className="space-y-2">
        {filtered.map((x) => (
          <button key={x.id} className="block w-full text-left" onClick={() => setParams({ task: x.id })}>
            <Card className={`flex items-start justify-between gap-3 hover:border-[var(--color-accent)] ${x.status !== 'open' ? 'opacity-60' : ''}`}>
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  {x.status === 'done'
                    ? <CheckCircle2 size={16} className="shrink-0 text-[var(--color-status-done)]" />
                    : <Circle size={16} className="shrink-0 text-[var(--color-ink-3)]" />}
                  <span className="text-sm font-medium">{x.title}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-ink-3)]">
                  <span>→ {namesOf(assigneesOf(x))}</span>
                  {x.due_date && (
                    <span className={overdue(x) ? 'font-semibold text-[var(--color-status-alert)]' : ''}>
                      Due {x.due_date}{overdue(x) ? ' — overdue' : ''}
                    </span>
                  )}
                  <LinkChips t={x} projects={projects.data?.data} />
                </div>
              </div>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <Chip kind={STATUS_CHIP[x.status]} label={taskStatusLabel(x.status)} />
                {x.priority === 'high' && <Chip kind={PRIORITY_CHIP.high} label="High" />}
              </span>
            </Card>
          </button>
        ))}
      </div>

      {/* New task */}
      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} title="New task">
        <div className="space-y-4">
          <TaskForm form={form} setForm={setForm} members={activeMembers}
                    projects={projects.data?.data ?? []} documents={documents.data?.data ?? []}
                    journals={journals.data?.data ?? []} />
          <Button className="w-full" onClick={() => create.mutate()}
                  disabled={!form.title.trim() || create.isPending}>
            Assign task
          </Button>
        </div>
      </Sheet>

      {/* Detail / edit */}
      <Sheet open={!!focusId} onClose={closeDetail}
             title={canEditTask ? 'Edit task' : 'Task'}>
        {detail.isLoading && <Skeleton className="h-40" />}
        {detail.isError && <ErrorState error={detail.error} retry={detail.refetch} />}
        {t && (
          <div className="space-y-4">
            {canEditTask ? (
              <TaskForm form={form} setForm={setForm} members={activeMembers}
                        projects={projects.data?.data ?? []} documents={documents.data?.data ?? []}
                        journals={journals.data?.data ?? []} />
            ) : (
              <div className="space-y-2">
                <p className="text-sm">{t.description || t.title}</p>
                <div className="text-xs text-[var(--color-ink-3)]">
                  {nameOf(t.creator_id)} → {namesOf(assigneesOf(t))}
                  {t.due_date && <> · Due {t.due_date}{overdue(t) ? ' (overdue)' : ''}</>}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {(canEditTask || isAssignee) && t.status === 'open' && (
                <Button onClick={() => update.mutate({ status: 'done' })}
                        disabled={update.isPending}>
                  Mark done
                </Button>
              )}
              {(canEditTask || isAssignee) && t.status === 'done' && (
                <Button variant="secondary" onClick={() => update.mutate({ status: 'open' })}>
                  Reopen
                </Button>
              )}
              {canEditTask && (
                <>
                  <Button variant="secondary" disabled={update.isPending}
                          onClick={() => update.mutate(payloadFrom(form))}>
                    Save changes
                  </Button>
                  {t.status !== 'cancelled' && (
                    <Button variant="secondary" onClick={() => update.mutate({ status: 'cancelled' })}>
                      Cancel task
                    </Button>
                  )}
                  <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={14} />Delete
                  </Button>
                </>
              )}
            </div>

            <div className="space-y-2 [border-top:var(--border-box)] pt-3">
              <div className="label-strong text-sm">Comments</div>
              {(detail.data?.comments ?? []).map((c) => (
                <div key={c.id} className="rounded-[var(--radius-input)] bg-[var(--color-surface-3)] px-3 py-2 text-sm">
                  <div className="text-xs font-medium text-[var(--color-ink-3)]">
                    {nameOf(c.author_id)} · {new Date(c.created_at).toLocaleString()}
                  </div>
                  {c.body}
                </div>
              ))}
              {(detail.data?.comments ?? []).length === 0 && (
                <p className="text-xs text-[var(--color-ink-3)]">No comments yet — the assignee and creator get pinged when one lands.</p>
              )}
              <div className="flex gap-2">
                <Input value={comment} onChange={(e) => setComment(e.target.value)}
                       placeholder="Write a comment…"
                       onKeyDown={(e) => { if (e.key === 'Enter' && comment.trim()) addComment.mutate(); }} />
                <Button onClick={() => addComment.mutate()} disabled={!comment.trim() || addComment.isPending}>
                  Send
                </Button>
              </div>
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmDelete} onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()} busy={remove.isPending}
        title="Delete this task?"
        body="The task and its comments are removed for everyone. Comments and notifications already sent stay in inboxes."
        confirmLabel="Delete task"
      />
    </div>
  );
}

function payloadFrom(form) {
  return {
    title: form.title, description: form.description || null,
    assignee_ids: form.assignee_ids, due_date: form.due_date || null,
    priority: form.priority, project_id: form.project_id || null,
    document_id: form.document_id || null,
    journal_entry_id: form.journal_entry_id || null,
  };
}
