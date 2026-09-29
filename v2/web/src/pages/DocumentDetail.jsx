import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Camera, PenLine, Pencil, Trash2, Undo2 } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { atLeast, currentOrgId, todayOrg } from '../lib/org';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { PhotoPicker } from '../components/PhotoPicker';
import { ChainFlow } from '../components/ChainFlow';
import { Button, Card, Chip, ConfirmDialog, Empty, ErrorState, Field, Input, Sheet, Skeleton } from '../components/ui';

export default function DocumentDetail() {
  const { id } = useParams();
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [moveOpen, setMoveOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);
  const [err, setErr] = useState(null);
  const [skipStep, setSkipStep] = useState(null);
  const [skipNote, setSkipNote] = useState('');
  const [pickChain, setPickChain] = useState('');
  const [revStep, setRevStep] = useState(null);   // pending step object, or 'late'
  const [revNote, setRevNote] = useState('');
  const [resend, setResend] = useState(new Set());
  const [signAllOpen, setSignAllOpen] = useState(false);
  const [moveStep, setMoveStep] = useState(''); // step_id the new movement pins to
  const [editMv, setEditMv] = useState(null);   // movement being edited
  const [delMv, setDelMv] = useState(null);     // movement pending delete confirm
  const { active } = useOutletContext() ?? {};
  const { session } = useAuth();
  const canWrite = active ? atLeast(active.role, 'officer') : false;
  const isOwner = active ? atLeast(active.role, 'owner') : false;
  const orgDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(iso));
  const canModifyMv = (m) =>
    canWrite && ((m.moved_by === session?.user?.id && orgDay(m.created_at) === todayOrg()) || isOwner);

  const q = useQuery({
    queryKey: ['document', org, id],
    queryFn: () => get(`/orgs/${org}/documents/${id}`),
    enabled: !!org,
  });
  const chains = useQuery({
    queryKey: ['chains', org],
    queryFn: () => get(`/orgs/${org}/signatory-chains`),
    enabled: !!org,
  });
  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members?pageSize=100`),
    enabled: !!org,
  });
  const nameOf = (uid) =>
    members.data?.data.find((m) => m.user_id === uid)?.display_name ?? null;

  const revise = useMutation({
    mutationFn: () => post(`/orgs/${org}/documents/${id}/revisions`, {
      at_step_id: revStep === 'late' ? null : revStep?.id,
      note: revNote.trim(),
      resend_step_ids: [...resend],
    }),
    onSuccess: () => {
      toast.success('Sent back for revision — new round started.');
      setRevStep(null); setRevNote(''); setResend(new Set());
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });
  const signAll = useMutation({
    mutationFn: () => post(`/orgs/${org}/documents/${id}/steps/sign-all`, {}),
    onSuccess: () => {
      toast.success('All pending steps signed.');
      setSignAllOpen(false);
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const attach = useMutation({
    mutationFn: () => post(`/orgs/${org}/documents/${id}/attach-chain`, { chain_id: pickChain }),
    onSuccess: () => {
      toast.success('Chain attached — this paper is now routing.');
      setPickChain('');
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const move = useMutation({
    mutationFn: async () => {
      let photo_path = null;
      const f = photos[0];
      if (f) {
        const sign = await post(
          `/orgs/${org}/journal/photos/sign`, { mime: f.type, byte_size: f.size });
        const put = await fetch(sign.upload_url, { method: 'PUT', body: f });
        if (!put.ok) throw new Error('Photo upload failed');
        photo_path = sign.path;
      }
      return post(`/orgs/${org}/documents/${id}/movements`, {
        location_text: location, note: note || null, photo_path,
        step_id: moveStep || null,
      });
    },
    onSuccess: () => {
      toast.success('Movement logged.');
      setMoveOpen(false); setLocation(''); setNote(''); setPhotos([]);
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => { setErr(e.message); toast.error(e.message); },
  });

  const editMovement = useMutation({
    mutationFn: () => patch(`/orgs/${org}/documents/${id}/movements/${editMv.id}`, {
      location_text: location, note: note || null }),
    onSuccess: () => {
      toast.success('Movement updated.');
      setEditMv(null); setLocation(''); setNote('');
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMovement = useMutation({
    mutationFn: (m) => del(`/orgs/${org}/documents/${id}/movements/${m.id}`),
    onSuccess: () => {
      toast.success('Movement deleted.');
      setDelMv(null);
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => { setDelMv(null); toast.error(e.message); },
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
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data;
  if (!d) return <Empty title="Document not found" />;

  const steps = d.signatory_steps;
  const RESOLVED = new Set(['signed', 'skipped', 'revision_requested']);
  const pendingNow = steps.filter((s) => s.status === 'pending' && s.round_no === d.current_round);
  const resolvedSteps = steps.filter((s) => RESOLVED.has(s.status));

  const openRevision = (step) => {   // step = pending row, or null for late revision
    setRevStep(step ?? 'late');
    setRevNote('');
    setResend(new Set(resolvedSteps.map((s) => s.id)));
  };

  const openMove = () => {
    setLocation(''); setNote(''); setPhotos([]);
    setMoveStep(pendingNow[0]?.id ?? '');   // default: pin to the current desk
    setMoveOpen(true);
  };

  return (
    <div className="space-y-4">
      <Link to="/documents" className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]">
        <ArrowLeft size={14} /> Papers
      </Link>
      <div>
        <h1 className="heading-strong text-2xl">{d.data.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Chip kind="neutral" label={d.data.doc_type} />
          <Chip kind={d.data.status === 'signed' ? 'done' : 'pending'}
                label={d.data.status === 'revision' ? 'in revision' : d.data.status} />
          {canWrite && ['signed', 'filed'].includes(d.data.status) && (
            <Button variant="secondary" className="min-h-[36px] px-3 text-xs"
                    onClick={() => openRevision(null)}>
              <Undo2 size={14} /> Send back for revision
            </Button>
          )}
        </div>
      </div>

      <Card className="flex items-center justify-between">
        <div>
          <div className="text-xs text-[var(--color-ink-3)]">Current location</div>
          <div className="font-semibold">{d.current_location ?? 'not recorded yet'}</div>
        </div>
        {canWrite && <Button onClick={openMove}>Move paper</Button>}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="label-strong text-sm text-[var(--color-ink-2)]">Signatory chain</div>
            <div className="text-xs text-[var(--color-ink-3)]">who signs, in order</div>
          </div>
          {canWrite && pendingNow.length >= 2 && (
            <Button variant="secondary" className="min-h-[36px] px-3 text-xs"
                    onClick={() => setSignAllOpen(true)}>
              <PenLine size={14} /> Sign all pending ({pendingNow.length})
            </Button>
          )}
        </div>
        {d.signatory_steps.length === 0 && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--color-status-alert)] p-3 text-sm text-[var(--color-ink-2)]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--color-status-alert)]" />
              <span>
                No signatory chain matches <span className="font-mono">{d.data.doc_type}</span> —
                this paper isn't routed for signatures.
                {isOwner
                  ? <> Add a <span className="font-mono">{d.data.doc_type}</span> chain in <Link to="/settings" className="text-[var(--color-accent)] underline">Settings → chains</Link>, or attach one below.</>
                  : ' Ask an owner to configure one, or attach an existing chain below.'}
              </span>
            </div>
            {canWrite && (chains.data?.data.length ?? 0) > 0 && (
              <div className="flex gap-2">
                <select
                  aria-label="Chain to attach"
                  className="min-h-[44px] flex-1 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
                  value={pickChain} onChange={(e) => setPickChain(e.target.value)}
                >
                  <option value="">attach a chain…</option>
                  {chains.data.data.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.doc_type})</option>
                  ))}
                </select>
                <Button variant="secondary" disabled={!pickChain || attach.isPending}
                        onClick={() => attach.mutate()}>
                  Attach
                </Button>
              </div>
            )}
            {canWrite && chains.data && chains.data.data.length === 0 && (
              <p className="text-xs text-[var(--color-ink-3)]">
                No chains exist yet — {isOwner
                  ? <>create one in <Link to="/settings" className="text-[var(--color-accent)] underline">Settings → chains</Link>.</>
                  : 'ask an owner to create one in Settings.'}
              </p>
            )}
          </div>
        )}
        <ChainFlow
          steps={steps}
          revisions={d.revisions}
          movements={d.movements}
          currentRound={d.current_round}
          nameOf={nameOf}
          canWrite={canWrite}
          onSign={(s) => advance.mutate({ stepId: s.id, status: 'signed' })}
          onSkip={(s) => { setSkipStep(s); setSkipNote(''); }}
          onSendBack={(s) => openRevision(s)}
        />
      </Card>

      <Card>
        <div className="label-strong mb-3 text-sm text-[var(--color-ink-2)]">Custody timeline</div>
        {d.movements.length === 0 && <Empty title="No movements yet" hint="Record where the paper is." />}
        <div className="space-y-3">
          {[...d.movements].reverse().map((m, i) => (
            <div key={m.id} className="border-l-2 border-[var(--color-line)] pl-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{m.location_text}</div>
                  {m.note && <div className="text-xs text-[var(--color-ink-2)]">{m.note}</div>}
                  <div className="flex items-center gap-1 text-xs text-[var(--color-ink-3)]">
                    {new Date(m.created_at).toLocaleString()}
                    {m.photo_path && <Camera size={12} aria-label="has photo" />}
                  </div>
                </div>
                {canModifyMv(m) && (
                  <span className="flex shrink-0 gap-1">
                    <Button variant="ghost" className="min-h-[32px] px-2 text-xs"
                            aria-label="Edit movement"
                            onClick={() => { setEditMv(m); setLocation(m.location_text); setNote(m.note ?? ''); }}>
                      <Pencil size={13} /> Edit
                    </Button>
                    <Button variant="ghost" className="min-h-[32px] px-2 text-xs text-[var(--color-status-alert)]"
                            aria-label="Delete movement"
                            onClick={() => setDelMv({ ...m, isNewest: i === 0, isOnly: d.movements.length === 1 })}>
                      <Trash2 size={13} /> Delete
                    </Button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Sheet open={moveOpen} onClose={() => setMoveOpen(false)} title="Move paper">
        <div className="space-y-3">
          <Field label="Where is it now?"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="SD office" /></Field>
          <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {pendingNow.length > 0 && (
            <Field label="Which step is this for?"
                   hint="Pins this movement (and its photo) onto that step's card.">
              <select
                className="min-h-[44px] w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
                value={moveStep} onChange={(e) => setMoveStep(e.target.value)}
              >
                {pendingNow.map((s) => (
                  <option key={s.id} value={s.id}>{s.ord}. {s.label}</option>
                ))}
                <option value="">no specific step</option>
              </select>
            </Field>
          )}
          <div className="text-xs text-[var(--color-ink-3)]">Photo of the paper/location (optional)</div>
          <PhotoPicker photos={photos} onChange={setPhotos} max={1} />
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

      <Sheet open={!!revStep} onClose={() => setRevStep(null)} title="Send back for revision">
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-ink-2)]">
            The paper needs changes. Pick which offices must sign again — the new round
            is appended to the log, nothing is overwritten.
          </p>
          <Field label="What needs changing? (required)"
                 hint="This becomes the note in the log — be specific.">
            <Input value={revNote} onChange={(e) => setRevNote(e.target.value)}
                   placeholder="revise page 3 — budget table" />
          </Field>
          {resolvedSteps.length > 0 && (
            <Field label="Re-sign needed from:">
              <div className="space-y-1.5">
                {resolvedSteps.map((s) => (
                  <label key={s.id} className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input
                      type="checkbox" className="h-4 w-4"
                      checked={resend.has(s.id)}
                      onChange={(e) => {
                        const next = new Set(resend);
                        if (e.target.checked) next.add(s.id); else next.delete(s.id);
                        setResend(next);
                      }}
                    />
                    {s.label}{s.office ? <span className="text-[var(--color-ink-3)]"> — {s.office}</span> : ''}
                  </label>
                ))}
              </div>
            </Field>
          )}
          <p className="text-xs text-[var(--color-ink-3)]">
            {revStep === 'late'
              ? 'The paper re-routes through the checked offices as a new round.'
              : `The paper re-routes through the checked offices, then returns to ${revStep?.label}.`}
          </p>
          <Button className="w-full" onClick={() => revise.mutate()}
                  disabled={!revNote.trim() || (revStep === 'late' && resend.size === 0) || revise.isPending}>
            Send back
          </Button>
        </div>
      </Sheet>

      <Sheet open={!!editMv} onClose={() => setEditMv(null)} title="Edit movement">
        <div className="space-y-3">
          <Field label="Where is it now?"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <p className="text-xs text-[var(--color-ink-3)]">
            Photos can't be changed on a movement — delete and re-record to swap a photo.
          </p>
          <Button className="w-full" onClick={() => editMovement.mutate()}
                  disabled={!location || editMovement.isPending}>
            {editMovement.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={!!delMv} onClose={() => setDelMv(null)} danger
        title="Delete this movement?"
        body={delMv?.isNewest
          ? (delMv.isOnly
              ? "This was the only recorded location — the paper's current location becomes unknown."
              : "This was the newest record — the paper's current location becomes the previous movement.")
          : 'This removes the record from the custody timeline. The current location is unchanged.'}
        confirmLabel="Delete movement"
        busy={deleteMovement.isPending}
        onConfirm={() => deleteMovement.mutate(delMv)}
      />

      <ConfirmDialog
        open={signAllOpen} onClose={() => setSignAllOpen(false)} danger={false}
        title="Sign all pending?"
        body={`Mark ${pendingNow.length} step${pendingNow.length === 1 ? '' : 's'} as signed by their offices? This records all signatures at once.`}
        confirmLabel="Sign all"
        busy={signAll.isPending}
        onConfirm={() => signAll.mutate()}
      />
    </div>
  );
}
