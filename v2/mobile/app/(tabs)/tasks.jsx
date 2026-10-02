/** Port of web/pages/Tasks.jsx — to-dos between people. Assign → the
 *  assignee is notified in-app, by email, and by push. Comments ping the
 *  assignee + creator. Everything here queues offline like any other write. */
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, FileText, FolderKanban, ListTodo, NotebookPen, Plus, Trash2 } from 'lucide-react-native';
import { del, get, isQueued, patch, post, queuedMsg } from '../../src/lib/api';
import { atLeast, useOrgId } from '../../src/lib/org';
import { useAuth } from '../../src/lib/auth';
import { useMe, useActiveMembership } from '../../src/lib/me';
import { useToast } from '../../src/lib/toast';
import { useTheme } from '../../src/lib/theme';
import { taskStatusLabel } from '../../src/lib/labels';
import {
  Button, Card, Chip, ConfirmDialog, Empty, ErrorState, Field, Input,
  PageHeader, Screen, Select, Sheet, Skeleton,
} from '../../src/components/ui';

const FILTERS = [
  { id: 'mine', label: 'Assigned to me' },
  { id: 'by-me', label: 'I assigned' },
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
];

const STATUS_CHIP = { open: 'pending', done: 'done', cancelled: 'skip' };

function overdue(t) {
  return t.status === 'open' && t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
}

/** Linked-entity chips — each navigates to its screen. */
function LinkChips({ t: task, projects, router }) {
  const proj = task.project_id ? projects?.find((p) => p.id === task.project_id) : null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {task.project_id ? (
        <Pressable onPress={() => router.push(`/project/${task.project_id}`)}>
          <Chip kind="neutral" icon={<FolderKanban size={11} color="#565656" />} label={proj ? proj.title : 'Project'} />
        </Pressable>
      ) : null}
      {task.document_id ? (
        <Pressable onPress={() => router.push(`/document/${task.document_id}`)}>
          <Chip kind="neutral" icon={<FileText size={11} color="#565656" />} label="Document" />
        </Pressable>
      ) : null}
      {task.journal_entry_id ? (
        <Pressable onPress={() => router.push('/journal')}>
          <Chip kind="neutral" icon={<NotebookPen size={11} color="#565656" />} label="Journal" />
        </Pressable>
      ) : null}
    </View>
  );
}

const BLANK = { title: '', description: '', assignee_id: '', due_date: '', priority: 'normal', project_id: '', document_id: '', journal_entry_id: '' };

function payloadFrom(form) {
  return {
    title: form.title, description: form.description || null,
    assignee_id: form.assignee_id || null, due_date: form.due_date || null,
    priority: form.priority, project_id: form.project_id || null,
    document_id: form.document_id || null,
    journal_entry_id: form.journal_entry_id || null,
  };
}

/** Create/edit form — shared between the new-task sheet and detail edit. */
function TaskForm({ form, setForm, members, projects, documents, journals, t }) {
  return (
    <View style={{ gap: 12 }}>
      <Field label="Task">
        <Input value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="Print the tarpaulin" />
      </Field>
      <Field label="Details (optional)">
        <Input value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} multiline
               placeholder="What done looks like, where the files are…" />
      </Field>
      <Field label="Assign to" hint="They get an in-app notification, an email, and a push ping.">
        <Select
          value={form.assignee_id}
          onChange={(v) => setForm({ ...form, assignee_id: v })}
          placeholder="Unassigned"
          accessibilityLabel="Assign to"
          options={[{ value: '', label: 'Unassigned' },
                    ...members.map((m) => ({ value: m.user_id, label: m.display_name }))]}
        />
      </Field>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label="Due (optional)" hint="YYYY-MM-DD">
            <Input value={form.due_date} onChangeText={(v) => setForm({ ...form, due_date: v })} placeholder="2026-01-15" />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Priority">
            <Select
              value={form.priority}
              onChange={(v) => setForm({ ...form, priority: v })}
              accessibilityLabel="Priority"
              options={[{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }]}
            />
          </Field>
        </View>
      </View>
      <Field label="Link to (optional)" hint="Point the task at the work it belongs to.">
        <View style={{ gap: 8 }}>
          <Select
            value={form.project_id}
            onChange={(v) => setForm({ ...form, project_id: v })}
            placeholder="No project"
            accessibilityLabel="Linked project"
            options={[{ value: '', label: 'No project' },
                      ...projects.map((p) => ({ value: p.id, label: p.title }))]}
          />
          <Select
            value={form.document_id}
            onChange={(v) => setForm({ ...form, document_id: v })}
            placeholder="No document"
            accessibilityLabel="Linked document"
            options={[{ value: '', label: 'No document' },
                      ...documents.map((d) => ({ value: d.id, label: d.title }))]}
          />
          <Select
            value={form.journal_entry_id}
            onChange={(v) => setForm({ ...form, journal_entry_id: v })}
            placeholder="No journal entry"
            accessibilityLabel="Linked journal entry"
            options={[{ value: '', label: 'No journal entry' },
                      ...journals.map((j) => ({
                        value: j.id,
                        label: `${j.entry_date} — ${j.description.slice(0, 40)}${j.description.length > 40 ? '…' : ''}`,
                      }))]}
          />
        </View>
      </Field>
    </View>
  );
}

export default function Tasks() {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { session } = useAuth();
  const me = useMe();
  const active = useActiveMembership(me.data);
  const { t } = useTheme();
  const [filter, setFilter] = useState('mine');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [comment, setComment] = useState('');

  const myId = session?.user?.id;
  const isOwner = active ? atLeast(active.role, 'owner') : false;
  const focusId = params.task ?? null;

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
    !id ? 'Unassigned'
      : id === myId ? 'You'
      : members.data?.data.find((m) => m.user_id === id)?.display_name ?? 'Someone';

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tasks', org] });
    qc.invalidateQueries({ queryKey: ['task', org] });
  };

  const create = useMutation({
    mutationFn: () => post(`/orgs/${org}/tasks`, payloadFrom(form)),
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'Task created — assignee notified.'));
      setCreateOpen(false); setForm(BLANK); invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: (patchBody) => patch(`/orgs/${org}/tasks/${focusId}`, patchBody),
    onSuccess: (r) => { toast.success(queuedMsg(r, 'Saved.')); invalidate(); detail.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => del(`/orgs/${org}/tasks/${focusId}`),
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'Task deleted.'));
      setConfirmDelete(false);
      router.setParams({ task: undefined });
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const addComment = useMutation({
    mutationFn: () => post(`/orgs/${org}/tasks/${focusId}/comments`, { body: comment }),
    onSuccess: (r) => { setComment(''); if (!isQueued(r)) detail.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const closeDetail = () => router.setParams({ task: undefined });
  const task = detail.data?.data;
  const canEditTask = task ? (String(task.creator_id) === myId || isOwner) : false;
  const isAssignee = task ? String(task.assignee_id) === myId : false;

  const list = tasks.data?.data ?? [];
  const filtered = list.filter((x) => {
    if (filter === 'mine') return String(x.assignee_id) === myId && x.status === 'open';
    if (filter === 'by-me') return String(x.creator_id) === myId;
    if (filter === 'open') return x.status === 'open';
    if (filter === 'done') return x.status === 'done';
    return true;
  });

  const openDetail = (row) => {
    // prefill the edit form from the list row — it already carries every field
    setForm({
      title: row.title, description: row.description ?? '',
      assignee_id: row.assignee_id ?? '', due_date: row.due_date ?? '',
      priority: row.priority, project_id: row.project_id ?? '',
      document_id: row.document_id ?? '', journal_entry_id: row.journal_entry_id ?? '',
    });
    router.setParams({ task: row.id });
  };

  return (
    <Screen refresh={async () => { await Promise.all([tasks.refetch(), members.refetch()]); }}>
      <PageHeader
        title="Tasks"
        description="To-dos between people — assign one and they’re notified."
        action={
          <Button onPress={() => { setForm(BLANK); setCreateOpen(true); }}>
            <Plus size={16} color={t.accentFg} /><Text style={{ color: t.accentFg, fontWeight: '700' }}>New task</Text>
          </Button>
        }
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            accessibilityRole="button"
            onPress={() => setFilter(f.id)}
            style={{
              minHeight: 36, justifyContent: 'center', borderRadius: t.radiusInput,
              paddingHorizontal: 12, borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor,
              backgroundColor: filter === f.id ? t.navActiveBg : t.surface2,
            }}
          >
            <Text style={{
              fontSize: 12, fontWeight: t.labelWeight, textTransform: t.labelTransform,
              letterSpacing: t.labelTracking, color: filter === f.id ? t.navActiveFg : t.ink2,
            }}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {tasks.isLoading ? <Skeleton style={{ height: 192 }} /> : null}
      {tasks.isError ? <ErrorState error={tasks.error} retry={tasks.refetch} /> : null}
      {tasks.isSuccess && filtered.length === 0 ? (
        <Empty
          icon={<ListTodo size={24} color={t.ink3} />}
          title={filter === 'mine' ? 'Nothing assigned to you' : 'No tasks here'}
          hint={filter === 'mine'
            ? 'When someone assigns you a task it lands here — and you get notified.'
            : 'Create a task and assign it to someone in the org.'}
          action={<Button onPress={() => { setForm(BLANK); setCreateOpen(true); }}>New task</Button>}
        />
      ) : null}

      <View style={{ gap: 8 }}>
        {filtered.map((x) => (
          <Pressable key={x.id} accessibilityRole="button" onPress={() => openDetail(x)}>
            <Card style={{
              flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
              gap: 8, opacity: x.status !== 'open' ? 0.6 : 1,
            }}>
              <View style={{ flexShrink: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {x.status === 'done'
                    ? <CheckCircle2 size={16} color={t.done} />
                    : <Circle size={16} color={t.ink3} />}
                  <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink, flexShrink: 1 }}>{x.title}</Text>
                </View>
                <Text style={{ fontSize: 12, color: t.ink3 }}>
                  → {nameOf(x.assignee_id)}
                  {x.due_date ? `  ·  Due ${x.due_date}${overdue(x) ? ' — overdue' : ''}` : ''}
                </Text>
                <LinkChips t={x} projects={projects.data?.data} router={router} />
              </View>
              <View style={{ gap: 4, alignItems: 'flex-end' }}>
                <Chip kind={STATUS_CHIP[x.status]} label={taskStatusLabel(x.status)} />
                {x.priority === 'high' ? <Chip kind="alert" label="High" /> : null}
              </View>
            </Card>
          </Pressable>
        ))}
      </View>

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} title="New task">
        <TaskForm form={form} setForm={setForm} members={activeMembers}
                  projects={projects.data?.data ?? []} documents={documents.data?.data ?? []}
                  journals={journals.data?.data ?? []} t={t} />
        <Button style={{ width: '100%' }} onPress={() => create.mutate()}
                disabled={!form.title.trim() || create.isPending} busy={create.isPending}>
          Assign task
        </Button>
      </Sheet>

      <Sheet open={!!focusId} onClose={closeDetail}
             title={canEditTask ? 'Edit task' : 'Task'}>
        {detail.isLoading ? <Skeleton style={{ height: 160 }} /> : null}
        {detail.isError ? <ErrorState error={detail.error} retry={detail.refetch} /> : null}
        {task ? (
          <View style={{ gap: 14 }}>
            {canEditTask ? (
              <TaskForm form={form} setForm={setForm} members={activeMembers}
                        projects={projects.data?.data ?? []} documents={documents.data?.data ?? []}
                        journals={journals.data?.data ?? []} t={t} />
            ) : (
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, color: t.ink }}>{task.description || task.title}</Text>
                <Text style={{ fontSize: 12, color: t.ink3 }}>
                  {nameOf(task.creator_id)} → {nameOf(task.assignee_id)}
                  {task.due_date ? ` · Due ${task.due_date}${overdue(task) ? ' (overdue)' : ''}` : ''}
                </Text>
                <LinkChips t={task} projects={projects.data?.data} router={router} />
              </View>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(canEditTask || isAssignee) && task.status === 'open' ? (
                <Button onPress={() => update.mutate({ status: 'done' })} disabled={update.isPending}>
                  Mark done
                </Button>
              ) : null}
              {(canEditTask || isAssignee) && task.status === 'done' ? (
                <Button variant="secondary" onPress={() => update.mutate({ status: 'open' })}>Reopen</Button>
              ) : null}
              {canEditTask ? (
                <>
                  <Button variant="secondary" disabled={update.isPending}
                          onPress={() => update.mutate(payloadFrom(form))}>
                    Save changes
                  </Button>
                  {task.status !== 'cancelled' ? (
                    <Button variant="secondary" onPress={() => update.mutate({ status: 'cancelled' })}>
                      Cancel task
                    </Button>
                  ) : null}
                  <Button variant="danger" onPress={() => setConfirmDelete(true)}>
                    <Trash2 size={14} color={t.accentFg} />Delete
                  </Button>
                </>
              ) : null}
            </View>

            <View style={{ gap: 8, borderTopWidth: Math.max(t.boxWidth, 1), borderTopColor: t.boxColor, paddingTop: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>
                Comments
              </Text>
              {(detail.data?.comments ?? []).map((c) => (
                <View key={c.id} style={{ borderRadius: t.radiusInput, backgroundColor: t.surface3, paddingHorizontal: 12, paddingVertical: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: t.ink3 }}>
                    {nameOf(c.author_id)} · {new Date(c.created_at).toLocaleString()}
                  </Text>
                  <Text style={{ fontSize: 14, color: t.ink }}>{c.body}</Text>
                </View>
              ))}
              {(detail.data?.comments ?? []).length === 0 ? (
                <Text style={{ fontSize: 12, color: t.ink3 }}>
                  No comments yet — the assignee and creator get pinged when one lands.
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Input value={comment} onChangeText={setComment} placeholder="Write a comment…"
                         onSubmitEditing={() => comment.trim() && addComment.mutate()} />
                </View>
                <Button onPress={() => addComment.mutate()} disabled={!comment.trim() || addComment.isPending}>
                  Send
                </Button>
              </View>
            </View>
          </View>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={confirmDelete} onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()} busy={remove.isPending}
        title="Delete this task?"
        body="The task and its comments are removed for everyone. Notifications already sent stay in inboxes."
        confirmLabel="Delete task"
      />
    </Screen>
  );
}
