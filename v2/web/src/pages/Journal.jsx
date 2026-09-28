import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import { NotebookPen, Pencil, Plus, Trash2 } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { currentOrgId, todayOrg } from '../lib/org';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { PhotoPicker } from '../components/PhotoPicker';
import { Button, Card, Chip, ConfirmDialog, Empty, ErrorState, Field, HintBanner, Input, PageHeader, Sheet, Skeleton } from '../components/ui';

function PhotoThumb({ org, photo }) {
  const q = useQuery({
    queryKey: ['photourl', photo.id],
    queryFn: () => get(`/orgs/${org}/photos/${photo.id}/url`),
    staleTime: 10 * 60 * 1000,
  });
  if (!q.data) return <Skeleton className="h-40 w-full" />;
  return <img src={q.data.url} alt="work photo" className="max-h-64 w-full rounded-[var(--radius-card)] object-cover" />;
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
  const [projectId, setProjectId] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (params.get('compose') === '1') setComposeOpen(true);
    if (params.get('notasks') === '1') noTasks.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const feed = useQuery({
    queryKey: ['journal', org],
    queryFn: () => get(`/orgs/${org}/journal?pageSize=50`),
    enabled: !!org,
  });
  const projects = useQuery({
    queryKey: ['projects', org],
    queryFn: () => get(`/orgs/${org}/projects?pageSize=100`),
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
    setPhotos([]);
    setErr(null);
    setComposeOpen(true);
  };

  const openCompose = () => {
    setEditing(null); setDesc(''); setPhotos([]); setProjectId(''); setErr(null);
    setComposeOpen(true);
  };

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (editing) {
        await patch(`/orgs/${org}/journal/${editing.id}`, {
          description: desc,
          project_id: projectId || null,
        });
        toast.success('Entry updated.');
      } else {
        const uploaded = [];
        for (const f of photos) {
          const sign = await post(
            `/orgs/${org}/journal/photos/sign`, { mime: f.type, byte_size: f.size });
          const put = await fetch(sign.upload_url, { method: 'PUT', body: f });
          if (!put.ok) throw new Error('Photo upload failed');
          uploaded.push({ storage_path: sign.path, mime: f.type, byte_size: f.size });
        }
        await post(`/orgs/${org}/journal`, {
          description: desc,
          project_id: projectId || null,
          photos: uploaded,
        });
        toast.success('Entry posted — day documented.');
      }
      setComposeOpen(false); setEditing(null); setDesc(''); setPhotos([]); setProjectId('');
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
                <span>{e.project_id && <Chip kind="neutral" label="project" />}</span>
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
            </Card>
          ))}
        </div>
      ))}

      <Sheet open={composeOpen} onClose={() => { setComposeOpen(false); setEditing(null); }}
             title={editing ? 'Edit entry' : "Log today's work"}>
        <div className="space-y-3">
          {!editing && <PhotoPicker photos={photos} onChange={setPhotos} />}
          {editing && (
            <p className="text-xs text-[var(--color-ink-3)]">
              Photos can't be changed on an existing entry — delete and re-file to swap photos.
            </p>
          )}
          <Field label="What did you do?">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)}
                   placeholder="Delivered concept paper to SD office" />
          </Field>
          <Field label="Project (optional)">
            <select className="min-h-[44px] w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
                    value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.data?.data.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
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
