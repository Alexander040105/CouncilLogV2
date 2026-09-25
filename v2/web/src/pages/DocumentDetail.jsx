import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Camera } from 'lucide-react';
import { get, post } from '../lib/api';
import { currentOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
import { Button, Card, Chip, Empty, Field, Input, Sheet, Skeleton } from '../components/ui';

export default function DocumentDetail() {
  const { id } = useParams();
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [moveOpen, setMoveOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const [skipStep, setSkipStep] = useState(null);
  const [skipNote, setSkipNote] = useState('');
  const fileRef = useRef(null);

  const q = useQuery({
    queryKey: ['document', org, id],
    queryFn: () => get(`/orgs/${org}/documents/${id}`),
  });

  const move = useMutation({
    mutationFn: async () => {
      let photo_path = null;
      if (file) {
        const sign = await post(
          `/orgs/${org}/journal/photos/sign`, { mime: file.type, byte_size: file.size });
        const put = await fetch(sign.upload_url, { method: 'PUT', body: file });
        if (!put.ok) throw new Error('Photo upload failed');
        photo_path = sign.path;
      }
      return post(`/orgs/${org}/documents/${id}/movements`, { location_text: location, note: note || null, photo_path });
    },
    onSuccess: () => {
      toast.success('Movement logged.');
      setMoveOpen(false); setLocation(''); setNote(''); setFile(null);
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => { setErr(e.message); toast.error(e.message); },
  });

  const advance = useMutation({
    mutationFn: ({ stepId, status, note }) =>
      post(`/orgs/${org}/documents/${id}/steps/${stepId}`, { status, note }),
    onSuccess: (_r, v) => {
      toast.success(v.status === 'signed' ? 'Step signed.' : 'Step skipped.');
      setSkipStep(null); setSkipNote('');
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-64" />;
  const d = q.data;
  if (!d) return <Empty title="Document not found" />;

  const stepKind = (s) => s === 'signed' ? 'done' : s === 'skipped' ? 'skip' : 'pending';

  return (
    <div className="space-y-4">
      <Link to="/documents" className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]">
        <ArrowLeft size={14} /> Papers
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{d.data.title}</h1>
        <div className="mt-1 flex flex-wrap gap-2">
          <Chip kind="neutral" label={d.data.doc_type} />
          <Chip kind={d.data.status === 'signed' ? 'done' : 'pending'} label={d.data.status} />
        </div>
      </div>

      <Card className="flex items-center justify-between">
        <div>
          <div className="text-xs text-[var(--color-ink-3)]">Current location</div>
          <div className="font-semibold">{d.current_location ?? 'not recorded yet'}</div>
        </div>
        <Button onClick={() => setMoveOpen(true)}>Move paper</Button>
      </Card>

      <Card>
        <div className="mb-1 text-sm font-medium text-[var(--color-ink-2)]">Signatory chain</div>
        <div className="mb-3 text-xs text-[var(--color-ink-3)]">who signs, in order</div>
        {d.signatory_steps.length === 0 && <Empty title="No signatory chain" hint="This document wasn't matched to a chain." />}
        <div className="space-y-2">
          {d.signatory_steps.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2">
              <div>
                <div className={`text-sm ${s.status !== 'pending' ? 'line-through text-[var(--color-ink-3)]' : ''}`}>
                  {s.ord}. {s.label}
                </div>
                {s.office && <div className="text-xs text-[var(--color-ink-3)]">{s.office}</div>}
                {s.note && <div className="text-xs text-[var(--color-ink-3)]">note: {s.note}</div>}
              </div>
              {s.status === 'pending' ? (
                <div className="flex gap-1">
                  <Button variant="secondary" className="min-h-[36px] px-2 text-xs"
                          onClick={() => advance.mutate({ stepId: s.id, status: 'signed' })}>Sign</Button>
                  <Button variant="ghost" className="min-h-[36px] px-2 text-xs"
                          onClick={() => { setSkipStep(s); setSkipNote(''); }}>Skip</Button>
                </div>
              ) : (
                <Chip kind={stepKind(s.status)} label={s.status} />
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-3 text-sm font-medium text-[var(--color-ink-2)]">Custody timeline</div>
        {d.movements.length === 0 && <Empty title="No movements yet" hint="Record where the paper is." />}
        <div className="space-y-3">
          {[...d.movements].reverse().map((m) => (
            <div key={m.id} className="border-l-2 border-[var(--color-line)] pl-3">
              <div className="text-sm font-medium">{m.location_text}</div>
              {m.note && <div className="text-xs text-[var(--color-ink-2)]">{m.note}</div>}
              <div className="flex items-center gap-1 text-xs text-[var(--color-ink-3)]">
                {new Date(m.created_at).toLocaleString()}
                {m.photo_path && <Camera size={12} aria-label="has photo" />}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Sheet open={moveOpen} onClose={() => setMoveOpen(false)} title="Move paper">
        <div className="space-y-3">
          <Field label="Where is it now?"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="SD office" /></Field>
          <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <button
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] py-6 text-sm text-[var(--color-ink-3)]"
            onClick={() => fileRef.current?.click()}
          >
            <Camera size={16} />
            {file ? file.name : 'Photo of the paper/location (optional)'}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
                 className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {err && <p className="text-sm text-[var(--color-status-alert)]">{err}</p>}
          <Button className="w-full" onClick={() => move.mutate()} disabled={!location || move.isPending}>Record movement</Button>
        </div>
      </Sheet>

      <Sheet open={!!skipStep} onClose={() => setSkipStep(null)} title="Skip this step?">
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-ink-2)]">
            Skipping <span className="font-medium">{skipStep?.label}</span> records it in the
            log — say why, so the next signer understands.
          </p>
          <Field label="Reason (required)">
            <Input value={skipNote} onChange={(e) => setSkipNote(e.target.value)}
                   placeholder="Office is closed this week" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSkipStep(null)}>Cancel</Button>
            <Button variant="danger" disabled={!skipNote.trim() || advance.isPending}
                    onClick={() => advance.mutate({ stepId: skipStep.id, status: 'skipped', note: skipNote.trim() })}>
              Skip step
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
