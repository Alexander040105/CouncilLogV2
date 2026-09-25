import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Camera, NotebookPen, Plus } from 'lucide-react';
import { get, post } from '../lib/api';
import { currentOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
import { Button, Card, Chip, Empty, Field, HintBanner, Input, PageHeader, Sheet, Skeleton } from '../components/ui';

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
  const [params, setParams] = useSearchParams();
  const [composeOpen, setComposeOpen] = useState(params.get('compose') === '1');
  const [desc, setDesc] = useState('');
  const [projectId, setProjectId] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (params.get('compose') === '1') setComposeOpen(true);
    if (params.get('notasks') === '1') noTasks.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const feed = useQuery({
    queryKey: ['journal', org],
    queryFn: () => get(`/orgs/${org}/journal?pageSize=50`),
  });
  const projects = useQuery({
    queryKey: ['projects', org],
    queryFn: () => get(`/orgs/${org}/projects?pageSize=100`),
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

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const photos = [];
      if (file) {
        const sign = await post(
          `/orgs/${org}/journal/photos/sign`, { mime: file.type, byte_size: file.size });
        const put = await fetch(sign.upload_url, { method: 'PUT', body: file });
        if (!put.ok) throw new Error('Photo upload failed');
        photos.push({ storage_path: sign.path, mime: file.type, byte_size: file.size });
      }
      await post(`/orgs/${org}/journal`, {
        description: desc,
        project_id: projectId || null,
        photos,
      });
      toast.success('Entry posted — day documented.');
      setComposeOpen(false); setDesc(''); setFile(null); setProjectId('');
      qc.invalidateQueries({ queryKey: ['journal', org] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
    } catch (e) {
      setErr(e.message);
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  const byDay = (feed.data?.data ?? []).reduce((m, e) => {
    (m[e.entry_date] ??= []).push(e);
    return m;
  }, {});

  return (
    <div className="space-y-4">
      <PageHeader
        title="Daily Journal"
        description="Photo + a line about what you did — that's the day's record."
        action={<Button onClick={() => setComposeOpen(true)}><Plus size={16} />Log work</Button>}
      />

      <HintBanner id="journal">
        Entries here prove your duty day — a photo is optional but encouraged. Off-day
        filings count as extra duty.
      </HintBanner>

      {feed.isLoading && <Skeleton className="h-48" />}
      {feed.data?.data.length === 0 && (
        <Empty icon={<NotebookPen size={24} />} title="No journal entries yet"
               hint="Photo + a line about what you did — that's the day's record."
               action={<Button onClick={() => setComposeOpen(true)}>Log work</Button>} />
      )}

      {Object.entries(byDay).map(([day, entries]) => (
        <div key={day} className="space-y-2">
          <div className="text-sm font-semibold text-[var(--color-ink-2)]">{day}</div>
          {entries.map((e) => (
            <Card key={e.id} className="space-y-2">
              {e.photos.map((p) => <PhotoThumb key={p.id} org={org} photo={p} />)}
              <div className="text-sm">{e.description}</div>
              {e.project_id && <Chip kind="neutral" label="project" />}
            </Card>
          ))}
        </div>
      ))}

      <Sheet open={composeOpen} onClose={() => setComposeOpen(false)} title="Log today's work">
        <div className="space-y-3">
          <button
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] py-8 text-sm text-[var(--color-ink-3)]"
            onClick={() => fileRef.current?.click()}
          >
            <Camera size={18} />
            {file ? file.name : 'Add photo'}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
                 className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Field label="What did you do?">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)}
                   placeholder="Delivered concept paper to SD office" />
          </Field>
          <Field label="Project (optional)">
            <select className="min-h-[44px] w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm"
                    value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">—</option>
              {projects.data?.data.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </Field>
          {err && <p className="text-sm text-[var(--color-status-alert)]">{err}</p>}
          <Button className="w-full" onClick={submit} disabled={busy || !desc.trim()}>
            {busy ? 'Posting…' : 'Post entry'}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
