import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import { MessageSquare, NotebookPen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { currentOrgId, todayOrg } from '../lib/org';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { PhotoPicker } from '../components/PhotoPicker';
import { Button, Card, Chip, ConfirmDialog, Empty, ErrorState, Field, HintBanner, Input, PageHeader, Sheet, Skeleton } from '../components/ui';

/** Expandable comment thread under a daily — lazy-loads on first open. */
function EntryComments({ org, entry, open, onToggle }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const q = useQuery({
    queryKey: ['journal-comments', org, entry.id],
    queryFn: () => get(`/orgs/${org}/journal/${entry.id}/comments`),
    enabled: open,
  });
  const add = useMutation({
    mutationFn: () => post(`/orgs/${org}/journal/${entry.id}/comments`, { body: text }),
    onSuccess: () => {
      setText('');
      q.refetch();
      qc.invalidateQueries({ queryKey: ['journal', org] }); // count chip updates
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div>
      <button onClick={onToggle} aria-expanded={open}
              className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-input)] px-2 text-xs text-[var(--color-ink-2)] hover:bg-[var(--color-surface-3)]">
        <MessageSquare size={13} />
        {entry.comment_count ? `${entry.comment_count} comment${entry.comment_count === 1 ? '' : 's'}` : 'Comment'}
      </button>
      {open && (
        <div className="mt-1 space-y-2 rounded-[var(--radius-input)] [border:var(--border-dash)] p-2">
          {(q.data?.data ?? []).map((c) => (
            <div key={c.id} className="text-xs">
              <span className="font-medium">{c.author_name}</span>
              <span className="ml-1 text-[var(--color-ink-3)]">{new Date(c.created_at).toLocaleString()}</span>
              <div className="text-sm text-[var(--color-ink-2)]">{c.body}</div>
            </div>
          ))}
          {(q.data?.data ?? []).length === 0 && (
            <p className="text-xs text-[var(--color-ink-3)]">No comments yet — the author gets pinged when one lands.</p>
          )}
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)}
                   placeholder="Say something helpful…"
                   onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) add.mutate(); }} />
            <Button variant="secondary" onClick={() => add.mutate()}
                    disabled={!text.trim() || add.isPending}>Send</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PhotoThumb({ org, photo, onRemove }) {
  const q = useQuery({
    queryKey: ['photourl', photo.id],
    queryFn: () => get(`/orgs/${org}/photos/${photo.id}/url`),
    staleTime: 10 * 60 * 1000,
  });
  if (!q.data) return <Skeleton className="h-40 w-full" />;
  const img = <img src={q.data.url} alt="work photo" loading="lazy" decoding="async" className="max-h-64 w-full rounded-[var(--radius-card)] object-cover" />;
  if (!onRemove) return img;
  return (
    <div className="relative">
      {img}
      <button
        aria-label="Remove this photo"
        className="absolute right-2 top-2 flex min-h-[32px] min-w-[32px] items-center justify-center rounded-full bg-black/60 text-white"
        onClick={onRemove}
      >
        <X size={15} />
      </button>
    </div>
  );
}

export default function Journal() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const { active } = useOutletContext() ?? {};
  const [params, setParams] = useSearchParams();
  const [composeOpen, setComposeOpen] = useState(params.get('compose') === '1');
  const [editing, setEditing] = useState(null);   // entry object being edited
  const [deleting, setDeleting] = useState(null); // entry object pending confirm
  const [desc, setDesc] = useState('');
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [docId, setDocId] = useState('');
  const [taskId, setTaskId] = useState(params.get('task') ?? '');
  const [commentsFor, setCommentsFor] = useState(null); // entry id with open thread
  const [photos, setPhotos] = useState([]);          // new File[] to upload
  const [keepIds, setKeepIds] = useState(null);      // edit mode: photo ids to keep
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (params.get('compose') === '1') setComposeOpen(true);
    if (params.get('notasks') === '1') noTasks.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?project=<id> / ?task=<id> scope the feed and pre-pick them in the
  // compose sheet — the "see all" / "log work" links elsewhere land here.
  const projParam = params.get('project');
  const taskParam = params.get('task');
  const feed = useQuery({
    queryKey: ['journal', org, projParam ?? '', taskParam ?? ''],
    queryFn: () => get(`/orgs/${org}/journal?pageSize=50${projParam ? `&project_id=${projParam}` : ''}${taskParam ? `&task_id=${taskParam}` : ''}`),
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
  const tasks = useQuery({
    queryKey: ['tasks-open', org],
    queryFn: () => get(`/orgs/${org}/tasks?status=open&pageSize=100`),
    enabled: !!org,
  });

  const noTasks = useMutation({
    mutationFn: () => post(`/orgs/${org}/attendance/no-tasks`, {}),
    onSuccess: () => {
      toast.success('Marked: no tasks today.');
      qc.invalidateQueries({ queryKey: ['attendance'] });
      params.delete('notasks'); setParams(params);
    },
    onError: (e) => toast.error(e.message),
  });

  const canModify = (e) =>
    (e.member_id === session?.user?.id && e.entry_date === todayOrg()) ||
    active?.role === 'owner';

  const openEdit = (e) => {
    setEditing(e);
    setDesc(e.description);
    setProjectId(e.project_id ?? '');
    setDocId(e.document_id ?? '');
    setTaskId(e.task_id ?? '');
    setPhotos([]);
    setKeepIds(new Set(e.photos.map((p) => p.id)));   // all kept; X drops one
    setErr(null);
    setComposeOpen(true);
  };

  const openCompose = () => {
    setEditing(null); setDesc(''); setPhotos([]);
    setProjectId(projParam ?? ''); setDocId(''); setTaskId(taskParam ?? '');
    setKeepIds(null); setErr(null);
    setComposeOpen(true);
  };

  const projTitle = (pid) => (projects.data?.data ?? []).find((p) => p.id === pid)?.title ?? 'a project';
  const docTitle = (did) => (documents.data?.data ?? []).find((d) => d.id === did)?.title ?? 'a paper';
  // with a project picked, only its papers are valid targets — the API
  // rejects a paper that belongs to a different project
  const paperOptions = (documents.data?.data ?? [])
    .filter((d) => !projectId || d.project_id === projectId);
  // same scoping rule for tasks — the API rejects a task from another project
  const taskOptions = (tasks.data?.data ?? [])
    .filter((x) => !projectId || !x.project_id || x.project_id === projectId);
  const pickProjectId = (pid) => {
    setProjectId(pid);
    // a paper/task tied to another project can't stay selected under this one
    const cur = (documents.data?.data ?? []).find((d) => d.id === docId);
    if (cur?.project_id && cur.project_id !== pid) setDocId('');
    const curTask = (tasks.data?.data ?? []).find((x) => x.id === taskId);
    if (curTask?.project_id && curTask.project_id !== pid) setTaskId('');
  };

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const uploaded = [];
      for (const f of photos) {
        const sign = await post(
          `/orgs/${org}/journal/photos/sign`, { mime: f.type, byte_size: f.size });
        const put = await fetch(sign.upload_url, { method: 'PUT', body: f });
        if (!put.ok) throw new Error('Photo upload failed');
        uploaded.push({ storage_path: sign.path, mime: f.type, byte_size: f.size });
      }
      if (editing) {
        await patch(`/orgs/${org}/journal/${editing.id}`, {
          description: desc,
          project_id: projectId || null,
          document_id: docId || null,
          task_id: taskId || null,
          add_photos: uploaded.length ? uploaded : null,
          remove_photo_ids: editing.photos.filter((p) => !keepIds.has(p.id)).map((p) => p.id),
        });
        toast.success('Entry updated.');
      } else {
        await post(`/orgs/${org}/journal`, {
          description: desc,
          project_id: projectId || null,
          document_id: docId || null,
          task_id: taskId || null,
          photos: uploaded,
        });
        toast.success('Entry posted — day documented.');
      }
      setComposeOpen(false); setEditing(null); setDesc(''); setPhotos([]); setProjectId(''); setDocId(''); setTaskId('');
      qc.invalidateQueries({ queryKey: ['journal', org] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
    } catch (e) {
      setErr(e.message);
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  const remove = useMutation({
    mutationFn: (entry) => del(`/orgs/${org}/journal/${entry.id}`),
    onSuccess: () => {
      toast.success('Entry deleted.');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['journal', org] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => { setDeleting(null); toast.error(e.message); },
  });

  const byDay = (feed.data?.data ?? []).reduce((m, e) => {
    (m[e.entry_date] ??= []).push(e);
    return m;
  }, {});

  return (
    <div className="space-y-4">
      <PageHeader
        title="Daily Journal"
        description="Photo + a line about what you did — that's the day's record."
        action={<Button onClick={openCompose}><Plus size={16} />Log work</Button>}
      />

      <HintBanner id="journal">
        Entries here prove your duty day — a photo is optional but encouraged. Off-day
        filings count as extra duty.
      </HintBanner>

      {projParam && (
        <div className="flex items-center gap-2 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-ink-2)]">
          <span>Showing entries for <b>{projParam && projects.data ? projTitle(projParam) : 'this project'}</b></span>
          <button className="ml-auto flex min-h-[28px] items-center gap-1 text-[var(--color-accent)]"
                  onClick={() => setParams((p) => { p.delete('project'); return p; })}>
            <X size={12} /> Show everything
          </button>
        </div>
      )}
      {taskParam && (
        <div className="flex items-center gap-2 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-ink-2)]">
          <span>Showing entries logged against <b>this task</b></span>
          <button className="ml-auto flex min-h-[28px] items-center gap-1 text-[var(--color-accent)]"
                  onClick={() => setParams((p) => { p.delete('task'); return p; })}>
            <X size={12} /> Show everything
          </button>
        </div>
      )}
      {feed.isLoading && <Skeleton className="h-48" />}
      {feed.isError && <ErrorState error={feed.error} retry={feed.refetch} />}
      {feed.data?.data.length === 0 && (
        <Empty icon={<NotebookPen size={24} />} title="No journal entries yet"
               hint="Photo + a line about what you did — that's the day's record."
               action={<Button onClick={openCompose}>Log work</Button>} />
      )}

      {Object.entries(byDay).map(([day, entries]) => (
        <div key={day} className="space-y-2">
          <div className="label-strong text-sm text-[var(--color-ink-2)]">{day}</div>
          {entries.map((e) => (
            <Card key={e.id} className="space-y-2">
              {e.photos.map((p) => <PhotoThumb key={p.id} org={org} photo={p} />)}
              <div className="text-sm">{e.description}</div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-1">
                  {e.project_id && <Chip kind="neutral" label={projTitle(e.project_id)} />}
                  {e.document_id && <Chip kind="extra" label={docTitle(e.document_id)} />}
                  {e.task_id && <Chip kind="pending" label={e.task_title ?? 'a task'} />}
                </span>
                {canModify(e) && (
                  <span className="flex gap-1">
                    <Button variant="ghost" className="min-h-[36px] px-2 text-xs"
                            aria-label="Edit entry" onClick={() => openEdit(e)}>
                      <Pencil size={14} /> Edit
                    </Button>
                    <Button variant="ghost" className="min-h-[36px] px-2 text-xs text-[var(--color-status-alert)]"
                            aria-label="Delete entry" onClick={() => setDeleting(e)}>
                      <Trash2 size={14} /> Delete
                    </Button>
                  </span>
                )}
              </div>
              <EntryComments org={org} entry={e}
                             open={commentsFor === e.id}
                             onToggle={() => setCommentsFor(commentsFor === e.id ? null : e.id)} />
            </Card>
          ))}
        </div>
      ))}

      <Sheet open={composeOpen} onClose={() => { setComposeOpen(false); setEditing(null); setKeepIds(null); }}
             title={editing ? 'Edit entry' : "Log today's work"}>
        <div className="space-y-3">
          {editing && editing.photos.length > 0 && (
            <div className="space-y-1">
              <span className="label-strong block text-sm text-[var(--color-ink-2)]">Photos on this entry</span>
              {editing.photos.filter((p) => keepIds?.has(p.id)).map((p) => (
                <PhotoThumb key={p.id} org={org} photo={p}
                            onRemove={() => setKeepIds((s) => { const n = new Set(s); n.delete(p.id); return n; })} />
              ))}
            </div>
          )}
          <PhotoPicker photos={photos} onChange={setPhotos}
                       max={editing ? Math.max(0, 4 - (keepIds?.size ?? 0)) : 4} />
          <Field label="What did you do?">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)}
                   placeholder="Delivered concept paper to SD office" />
          </Field>
          <Field label="Project (optional)">
            <select className="min-h-[44px] w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
                    value={projectId} onChange={(e) => pickProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.data?.data.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </Field>
          <Field label="Paper (optional)"
                 hint={projectId
                   ? 'Only papers registered to that project are listed.'
                   : 'Tagging a paper counts the entry under its project too.'}>
            <select className="min-h-[44px] w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
                    value={docId} onChange={(e) => setDocId(e.target.value)}>
              <option value="">No paper</option>
              {paperOptions.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </Field>
          <Field label="Task (optional)"
                 hint="Which task this work moved forward — it shows on the task's page.">
            <select className="min-h-[44px] w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
                    value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">No task</option>
              {taskOptions.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </Field>
          {err && <p className="text-sm text-[var(--color-status-alert)]">{err}</p>}
          <Button className="w-full" onClick={submit} disabled={busy || !desc.trim()}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Post entry'}
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting)}
        busy={remove.isPending}
        title="Delete this entry?"
        body={`Deleting it removes the proof for ${deleting?.entry_date} — that day becomes unaccounted unless another entry exists. You can re-file or declare no tasks.`}
        confirmLabel="Delete entry"
      />
    </div>
  );
}
