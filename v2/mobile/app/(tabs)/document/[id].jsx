/** Port of web/pages/DocumentDetail.jsx — custody + signatory rounds:
 *  move w/ photo, sign/skip/send-back, attach chain, sign-all, revisions. */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Camera, PenLine, Pencil, Trash2, Undo2 } from 'lucide-react-native';
import { del, get, isQueued, patch, post, queuedMsg } from '../../../src/lib/api';
import { submitPhotoRecord } from '../../../src/lib/offline';
import { atLeast, todayOrg, useOrgId } from '../../../src/lib/org';
import { useAuth } from '../../../src/lib/auth';
import { useToast } from '../../../src/lib/toast';
import { useTheme } from '../../../src/lib/theme';
import { useMe, useActiveMembership } from '../../../src/lib/me';
import { docStatusLabel, docTypeLabel } from '../../../src/lib/labels';
import { PhotoPicker, putToSignedUrl } from '../../../src/components/PhotoPicker';
import { ChainFlow } from '../../../src/components/ChainFlow';
import { Button, Card, CheckRow, Chip, ConfirmDialog, Empty, ErrorState, Field, Input, Screen, Select, Sheet, Skeleton } from '../../../src/components/ui';

export default function DocumentDetail() {
  const { id } = useLocalSearchParams();
  const org = useOrgId();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const [moveOpen, setMoveOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [moveStep, setMoveStep] = useState('');   // step this move/photo belongs to
  const [photos, setPhotos] = useState([]);
  const [err, setErr] = useState(null);
  const [skipStep, setSkipStep] = useState(null);
  const [skipNote, setSkipNote] = useState('');
  const [pickChain, setPickChain] = useState('');
  const [revStep, setRevStep] = useState(null);   // step object (pending or resolved), or 'late'
  const [revNote, setRevNote] = useState('');
  const [resend, setResend] = useState(new Set());   // resolved ids to re-sign
  const [carry, setCarry] = useState(new Set());     // pending ids to keep on the route
  const [signAllOpen, setSignAllOpen] = useState(false);
  const [editMv, setEditMv] = useState(null);   // movement being edited
  const [delMv, setDelMv] = useState(null);     // movement pending delete confirm
  const [clearMvPhoto, setClearMvPhoto] = useState(false);
  const me = useMe();
  const { session } = useAuth();
  const active = useActiveMembership(me.data);
  const canWrite = active ? atLeast(active.role, 'officer') : false;
  const isOwner = active ? atLeast(active.role, 'owner') : false;
  const orgDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(iso));
  const canModifyMv = (m) =>
    canWrite && ((m.moved_by === session?.user?.id && orgDay(m.created_at) === todayOrg()) || isOwner);

  const q = useQuery({
    queryKey: ['document', org, id],
    queryFn: () => get(`/orgs/${org}/documents/${id}`),
    enabled: !!org && !!id,
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
    mutationFn: () => {
      const isReturn = revStep !== 'late' && revStep?.status !== 'pending';
      return post(`/orgs/${org}/documents/${id}/revisions`, {
        at_step_id: revStep === 'late' || isReturn ? null : revStep?.id,
        return_to_step_id: isReturn ? revStep.id : null,
        note: revNote.trim(),
        resend_step_ids: [...resend, ...carry],
      });
    },
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'Sent back for revision — new round started.'));
      setRevStep(null); setRevNote(''); setResend(new Set()); setCarry(new Set());
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });
  const signAll = useMutation({
    mutationFn: () => post(`/orgs/${org}/documents/${id}/steps/sign-all`, {}),
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'All pending steps signed.'));
      setSignAllOpen(false);
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });
  const attach = useMutation({
    mutationFn: () => post(`/orgs/${org}/documents/${id}/attach-chain`, { chain_id: pickChain }),
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'Chain attached — this paper is now routing.'));
      setPickChain('');
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });
  const move = useMutation({
    mutationFn: async () => submitPhotoRecord({
      orgId: org,
      signPath: `/orgs/${org}/journal/photos/sign`,
      photos,
      recordPath: `/orgs/${org}/documents/${id}/movements`,
      recordBody: {
        location_text: location,
        note: note || null,
        step_id: moveStep || null,
        photo_path: '{{photo_path}}',
      },
    }),
    onSuccess: (r) => {
      toast.success(isQueued(r)
        ? 'Saved on this device — sends when you’re back online.'
        : 'Movement logged.');
      setMoveOpen(false); setLocation(''); setNote(''); setPhotos([]); setMoveStep('');
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => { setErr(e.message); toast.error(e.message); },
  });
  const editMovement = useMutation({
    mutationFn: async () => {
      let photo_path;
      const f = photos[0];
      if (f) {
        const sign = await post(`/orgs/${org}/journal/photos/sign`,
          { mime: f.type ?? f.mime, byte_size: f.size ?? f.byte_size });
        await putToSignedUrl(sign.upload_url, f);
        photo_path = sign.path;
      }
      return patch(`/orgs/${org}/documents/${id}/movements/${editMv.id}`, {
        location_text: location, note: note || null,
        photo_path, clear_photo: !photo_path && clearMvPhoto ? true : undefined });
    },
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'Movement updated.'));
      setEditMv(null); setLocation(''); setNote(''); setPhotos([]); setClearMvPhoto(false);
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMovement = useMutation({
    mutationFn: (m) => del(`/orgs/${org}/documents/${id}/movements/${m.id}`),
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'Movement deleted.'));
      setDelMv(null);
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => { setDelMv(null); toast.error(e.message); },
  });
  const advance = useMutation({
    mutationFn: ({ stepId, status, note: n }) =>
      post(`/orgs/${org}/documents/${id}/steps/${stepId}`, { status, note: n }),
    onSuccess: (r, v) => {
      toast.success(queuedMsg(r, v.status === 'signed' ? 'Step signed.' : 'Step skipped.'));
      setSkipStep(null); setSkipNote('');
      qc.invalidateQueries({ queryKey: ['document', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <Screen><Skeleton style={{ height: 256 }} /></Screen>;
  if (q.isError) return <Screen><ErrorState error={q.error} retry={q.refetch} /></Screen>;
  const d = q.data;
  if (!d) return <Screen><Empty title="Document not found" /></Screen>;

  const steps = d.signatory_steps;
  const RESOLVED = new Set(['signed', 'skipped', 'revision_requested']);
  const pendingNow = steps.filter((s) => s.status === 'pending' && s.round_no === d.current_round);
  const resolvedSteps = steps.filter((s) => RESOLVED.has(s.status));

  const openRevision = (step) => {   // step = pending or resolved row; null = late revision
    setRevStep(step ?? 'late');
    setRevNote('');
    setResend(new Set(resolvedSteps.filter((s) => s.id !== step?.id).map((s) => s.id)));
    setCarry(new Set(pendingNow.filter((s) => s.id !== step?.id).map((s) => s.id)));
  };

  const miniBtn = {
    minHeight: 36, paddingHorizontal: 10, justifyContent: 'center',
    borderRadius: t.radiusInput, borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor,
    backgroundColor: t.surface3,
  };

  return (
    <Screen refresh={q.refetch}>
      <Pressable accessibilityRole="button" onPress={() => router.back()}
                 style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} color={t.ink3} /><Text style={{ fontSize: 14, color: t.ink3 }}>Papers</Text>
      </Pressable>
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 24, fontWeight: t.headingWeight, color: t.ink }}>{d.data.title}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Chip kind="neutral" label={docTypeLabel(d.data.doc_type)} />
          <Chip kind={d.data.status === 'signed' ? 'done' : 'pending'}
                label={docStatusLabel(d.data.status)} />
        </View>
        {canWrite && ['signed', 'filed'].includes(d.data.status) ? (
          <Pressable accessibilityRole="button" onPress={() => openRevision(null)}
                     style={[miniBtn, { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
            <Undo2 size={13} color={t.ink2} /><Text style={{ fontSize: 12, color: t.ink2 }}>Send back for revision</Text>
          </Pressable>
        ) : null}
      </View>

      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ fontSize: 12, color: t.ink3 }}>Current location</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: t.ink }}>{d.current_location ?? 'Not recorded yet'}</Text>
        </View>
        {canWrite ? (
          <Button onPress={() => {
            setLocation(''); setNote(''); setPhotos([]);
            setMoveStep(pendingNow[0]?.id ?? '');   // default: pin to the current desk
            setMoveOpen(true);
          }}>Move paper</Button>
        ) : null}
      </Card>

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <View>
            <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>Signatory chain</Text>
            <Text style={{ fontSize: 12, color: t.ink3 }}>Who signs, in order</Text>
          </View>
          {canWrite && pendingNow.length >= 2 ? (
            <Pressable accessibilityRole="button" onPress={() => setSignAllOpen(true)}
                       style={[miniBtn, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
              <PenLine size={13} color={t.ink2} /><Text style={{ fontSize: 12, color: t.ink2 }}>Sign all pending ({pendingNow.length})</Text>
            </Pressable>
          ) : null}
        </View>
        {d.signatory_steps.length === 0 ? (
          <View style={{ gap: 12 }}>
            <View style={{
              flexDirection: 'row', gap: 8, alignItems: 'flex-start',
              borderRadius: t.radiusCard, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.alert, padding: 12,
            }}>
              <AlertTriangle size={16} color={t.alert} style={{ marginTop: 2 }} />
              <Text style={{ flex: 1, fontSize: 13, color: t.ink2 }}>
                No signatory chain matches {docTypeLabel(d.data.doc_type)} — this paper isn’t routed for signatures.
                {isOwner ? ' Add a chain in Settings → chains, or attach one below.' : ' Ask an owner to configure one, or attach an existing chain below.'}
              </Text>
            </View>
            {canWrite && (chains.data?.data.length ?? 0) > 0 ? (
              <View style={{ gap: 8 }}>
                <Select
                  value={pickChain}
                  onChange={setPickChain}
                  placeholder="Attach a chain…"
                  accessibilityLabel="Chain to attach"
                  options={chains.data.data.map((c) => ({ value: c.id, label: `${c.name} (${docTypeLabel(c.doc_type)})` }))}
                />
                <Button variant="secondary" disabled={!pickChain || attach.isPending} onPress={() => attach.mutate()} busy={attach.isPending}>
                  Attach
                </Button>
              </View>
            ) : null}
            {canWrite && chains.data && chains.data.data.length === 0 ? (
              <Text style={{ fontSize: 12, color: t.ink3 }}>
                No chains exist yet — {isOwner ? 'create one in Settings → chains.' : 'ask an owner to create one in Settings.'}
              </Text>
            ) : null}
          </View>
        ) : null}
        {d.signatory_steps.length > 0 ? (
          <ChainFlow
            steps={steps}
            revisions={d.revisions}
            movements={d.movements}
            currentRound={d.current_round}
            nameOf={nameOf}
            canWrite={canWrite}
            docId={id}
            onSign={(s) => advance.mutate({ stepId: s.id, status: 'signed' })}
            onSkip={(s) => { setSkipStep(s); setSkipNote(''); }}
            onSendBack={(s) => openRevision(s)}
            onReturnTo={(s) => openRevision(s)}
          />
        ) : null}
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>Custody timeline</Text>
        {d.movements.length === 0 ? <Empty title="No movements yet" hint="Record where the paper is." /> : null}
        <View style={{ gap: 12 }}>
          {[...d.movements].reverse().map((m, i) => (
            <View key={m.id} style={{ borderLeftWidth: 2, borderLeftColor: t.line, paddingLeft: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>{m.location_text}</Text>
              {m.note ? <Text style={{ fontSize: 12, color: t.ink2 }}>{m.note}</Text> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
                  <Text style={{ fontSize: 12, color: t.ink3 }}>{new Date(m.created_at).toLocaleString()}</Text>
                  {m.photo_path ? <Camera size={12} color={t.ink3} accessibilityLabel="has photo" /> : null}
                </View>
                {canModifyMv(m) ? (
                  <View style={{ flexDirection: 'row', gap: 2, flexShrink: 0 }}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Edit movement"
                               style={[miniBtn, { backgroundColor: 'transparent', borderWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 3 }]}
                               onPress={() => { setEditMv(m); setLocation(m.location_text); setNote(m.note ?? ''); }}>
                      <Pencil size={12} color={t.ink2} /><Text style={{ fontSize: 12, color: t.ink2 }}>Edit</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Delete movement"
                               style={[miniBtn, { backgroundColor: 'transparent', borderWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 3 }]}
                               onPress={() => setDelMv({ ...m, isNewest: i === 0, isOnly: d.movements.length === 1 })}>
                      <Trash2 size={12} color={t.alert} /><Text style={{ fontSize: 12, color: t.alert }}>Delete</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </Card>

      <Sheet open={moveOpen} onClose={() => setMoveOpen(false)} title="Move paper">
        <Field label="Where is it now?"><Input value={location} onChangeText={setLocation} placeholder="SD office" /></Field>
        {d.signatory_steps.length > 0 ? (
          <Field label="Which step is this for? (optional)" hint="Pins the move and photo onto that step's card.">
            <Select
              value={moveStep}
              onChange={setMoveStep}
              placeholder="Not tied to a step"
              accessibilityLabel="Step this move belongs to"
              options={[
                { value: '', label: 'Not tied to a step' },
                ...steps.filter((s) => s.round_no === d.current_round)
                  .map((s) => ({ value: s.id, label: `${s.ord}. ${s.label}` })),
              ]}
            />
          </Field>
        ) : null}
        <Field label="Note (optional)"><Input value={note} onChangeText={setNote} /></Field>
        <Text style={{ fontSize: 12, color: t.ink3 }}>Photo of the paper/location (optional)</Text>
        <PhotoPicker photos={photos} onChange={setPhotos} max={1} />
        {err ? <Text style={{ fontSize: 13, color: t.alert }}>{err}</Text> : null}
        <Button style={{ width: '100%' }} onPress={() => move.mutate()} disabled={!location || move.isPending} busy={move.isPending}>Record movement</Button>
      </Sheet>

      <Sheet open={!!skipStep} onClose={() => setSkipStep(null)} title="Skip this step?">
        <Text style={{ fontSize: 14, color: t.ink2 }}>
          Skipping <Text style={{ fontWeight: '700' }}>{skipStep?.label}</Text> records it in the
          log — say why, so the next signer understands.
        </Text>
        <Field label="Reason (required)">
          <Input value={skipNote} onChangeText={setSkipNote} placeholder="Office is closed this week" />
        </Field>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onPress={() => setSkipStep(null)}>Cancel</Button>
          <Button variant="danger" disabled={!skipNote.trim() || advance.isPending} busy={advance.isPending}
                  onPress={() => advance.mutate({ stepId: skipStep.id, status: 'skipped', note: skipNote.trim() })}>
            Skip step
          </Button>
        </View>
      </Sheet>

      <Sheet open={!!revStep} onClose={() => setRevStep(null)} title="Send back for revision">
        <Text style={{ fontSize: 14, color: t.ink2 }}>
          {revStep === 'late'
            ? 'The paper needs changes after signing. Pick which offices must sign again — the new round is appended to the log, nothing is overwritten.'
            : revStep?.status === 'pending'
              ? `Sending back from ${revStep?.label} — that desk keeps its place in the new round.`
              : `Return to ${revStep?.label} — that office signs again in the new round, even though it already signed.`}
        </Text>
        <Field label="What needs changing? (required)"
               hint="This becomes the note in the log — be specific.">
          <Input value={revNote} onChangeText={setRevNote} placeholder="revise page 3 — budget table" />
        </Field>
        {resolvedSteps.filter((s) => s.id !== revStep?.id).length > 0 ? (
          <Field label="Offices that must sign again:">
            <View style={{ gap: 2 }}>
              {resolvedSteps.filter((s) => s.id !== revStep?.id).map((s) => (
                <CheckRow
                  key={s.id}
                  checked={resend.has(s.id)}
                  onChange={(on) => {
                    const next = new Set(resend);
                    if (on) next.add(s.id); else next.delete(s.id);
                    setResend(next);
                  }}
                  label={`${s.label}${s.office ? ` — ${s.office}` : ''}`}
                />
              ))}
            </View>
          </Field>
        ) : null}
        {pendingNow.filter((s) => s.id !== revStep?.id).length > 0 ? (
          <Field label="Still waiting to sign — keep them on the route?"
                 hint="Unchecked desks fall off the route — the paper won't wait for them anymore.">
            <View style={{ gap: 2 }}>
              {pendingNow.filter((s) => s.id !== revStep?.id).map((s) => (
                <CheckRow
                  key={s.id}
                  checked={carry.has(s.id)}
                  onChange={(on) => {
                    const next = new Set(carry);
                    if (on) next.add(s.id); else next.delete(s.id);
                    setCarry(next);
                  }}
                  label={`${s.label}${s.office ? ` — ${s.office}` : ''} (still pending)`}
                />
              ))}
            </View>
          </Field>
        ) : null}
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          New round signs: {[
            ...(revStep !== 'late' && revStep ? [revStep.label] : []),
            ...resolvedSteps.filter((s) => resend.has(s.id)).map((s) => s.label),
            ...pendingNow.filter((s) => carry.has(s.id)).map((s) => s.label),
          ].join(' → ') || 'nobody — pick at least one office'}.
          {pendingNow.some((s) => s.id !== revStep?.id && !carry.has(s.id))
            ? ' Anything left unchecked drops off the route.' : ''}
        </Text>
        <Button style={{ width: '100%' }} onPress={() => revise.mutate()}
                disabled={!revNote.trim() || (revStep === 'late' && resend.size === 0) || revise.isPending} busy={revise.isPending}>
          Send back
        </Button>
      </Sheet>

      <Sheet open={!!editMv} onClose={() => { setEditMv(null); setPhotos([]); setClearMvPhoto(false); }} title="Edit movement">
        <Field label="Where is it now?"><Input value={location} onChangeText={setLocation} /></Field>
        <Field label="Note (optional)"><Input value={note} onChangeText={setNote} /></Field>
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>Photo</Text>
          {editMv?.photo_path && !clearMvPhoto && photos.length === 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: t.radiusInput, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor, padding: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Camera size={13} color={t.ink2} />
                <Text style={{ fontSize: 12, color: t.ink2 }}>A photo is attached</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setClearMvPhoto(true)}
                         style={{ minHeight: 32, justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, color: t.alert }}>Remove</Text>
              </Pressable>
            </View>
          ) : null}
          {clearMvPhoto ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: t.radiusInput, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor, padding: 8 }}>
              <Text style={{ fontSize: 12, color: t.ink2 }}>Photo will be removed on save</Text>
              <Pressable accessibilityRole="button" onPress={() => setClearMvPhoto(false)}
                         style={{ minHeight: 32, justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, color: t.brand }}>Keep it</Text>
              </Pressable>
            </View>
          ) : null}
          {!clearMvPhoto ? (
            <PhotoPicker photos={photos} max={1}
                         onChange={(p) => { setPhotos(p); if (p.length) setClearMvPhoto(false); }} />
          ) : null}
          <Text style={{ fontSize: 12, color: t.ink3 }}>
            Picking a new photo replaces the old one when you save.
          </Text>
        </View>
        <Button style={{ width: '100%' }} onPress={() => editMovement.mutate()}
                disabled={!location || editMovement.isPending} busy={editMovement.isPending}>
          Save changes
        </Button>
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
    </Screen>
  );
}
