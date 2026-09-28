/** Port of web/pages/DocumentDetail.jsx — custody + signatory rounds:
 *  move w/ photo, sign/skip/send-back, attach chain, sign-all, revisions. */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Camera, PenLine, Pencil, Trash2, Undo2 } from 'lucide-react-native';
import { del, get, patch, post } from '../../../src/lib/api';
import { atLeast, todayOrg, useOrgId } from '../../../src/lib/org';
import { useAuth } from '../../../src/lib/auth';
import { useToast } from '../../../src/lib/toast';
import { useTheme } from '../../../src/lib/theme';
import { useMe, useActiveMembership } from '../../../src/lib/me';
import { PhotoPicker, putToSignedUrl } from '../../../src/components/PhotoPicker';
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
  const [photos, setPhotos] = useState([]);
  const [err, setErr] = useState(null);
  const [skipStep, setSkipStep] = useState(null);
  const [skipNote, setSkipNote] = useState('');
  const [pickChain, setPickChain] = useState('');
  const [revStep, setRevStep] = useState(null);   // pending step object, or 'late'
  const [revNote, setRevNote] = useState('');
  const [resend, setResend] = useState(new Set());
  const [signAllOpen, setSignAllOpen] = useState(false);
  const [editMv, setEditMv] = useState(null);   // movement being edited
  const [delMv, setDelMv] = useState(null);     // movement pending delete confirm
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
        const sign = await post(`/orgs/${org}/journal/photos/sign`, { mime: f.type, byte_size: f.size });
        await putToSignedUrl(sign.upload_url, f);
        photo_path = sign.path;
      }
      return post(`/orgs/${org}/documents/${id}/movements`, { location_text: location, note: note || null, photo_path });
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
    mutationFn: ({ stepId, status, note: n }) =>
      post(`/orgs/${org}/documents/${id}/steps/${stepId}`, { status, note: n }),
    onSuccess: (_r, v) => {
      toast.success(v.status === 'signed' ? 'Step signed.' : 'Step skipped.');
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
  const rounds = [...new Set(steps.map((s) => s.round_no))].sort((a, b) => a - b);
  const multiRound = rounds.length > 1;
  const pendingNow = steps.filter((s) => s.status === 'pending' && s.round_no === d.current_round);
  const resolvedSteps = steps.filter((s) => RESOLVED.has(s.status));

  const openRevision = (step) => {
    setRevStep(step ?? 'late');
    setRevNote('');
    setResend(new Set(resolvedSteps.map((s) => s.id)));
  };

  const stepChip = (s) =>
    s.status === 'revision_requested' ? { kind: 'alert', label: 'sent back' }
    : s.status === 'superseded' ? { kind: 'skip', label: 'superseded' }
    : s.status === 'signed' ? { kind: 'done', label: 'signed' }
    : { kind: 'skip', label: 'skipped' };

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
          <Chip kind="neutral" label={d.data.doc_type} />
          <Chip kind={d.data.status === 'signed' ? 'done' : 'pending'}
                label={d.data.status === 'revision' ? 'in revision' : d.data.status} />
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
          <Text style={{ fontSize: 16, fontWeight: '700', color: t.ink }}>{d.current_location ?? 'not recorded yet'}</Text>
        </View>
        {canWrite ? <Button onPress={() => { setLocation(''); setNote(''); setPhotos([]); setMoveOpen(true); }}>Move paper</Button> : null}
      </Card>

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <View>
            <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>Signatory chain</Text>
            <Text style={{ fontSize: 12, color: t.ink3 }}>who signs, in order</Text>
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
                No signatory chain matches {d.data.doc_type} — this paper isn't routed for signatures.
                {isOwner ? ' Add a chain in Settings → chains, or attach one below.' : ' Ask an owner to configure one, or attach an existing chain below.'}
              </Text>
            </View>
            {canWrite && (chains.data?.data.length ?? 0) > 0 ? (
              <View style={{ gap: 8 }}>
                <Select
                  value={pickChain}
                  onChange={setPickChain}
                  placeholder="attach a chain…"
                  accessibilityLabel="Chain to attach"
                  options={chains.data.data.map((c) => ({ value: c.id, label: `${c.name} (${c.doc_type})` }))}
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
        <View style={{ gap: 12 }}>
          {rounds.map((rn) => {
            const rSteps = steps.filter((s) => s.round_no === rn);
            const rev = (d.revisions ?? []).find((r) => r.round_no === rn);
            return (
              <View key={rn} style={{ gap: 6 }}>
                {rn > 1 && rev ? (
                  <View style={{
                    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
                    borderRadius: t.radiusCard, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.alert, padding: 10,
                  }}>
                    <Undo2 size={14} color={t.alert} style={{ marginTop: 1 }} />
                    <Text style={{ flex: 1, fontSize: 12, color: t.ink2 }}>
                      <Text style={{ fontWeight: '700' }}>Returned for revision</Text> — {rev.note}
                      <Text style={{ color: t.ink3 }}>
                        {nameOf(rev.created_by) ? ` · ${nameOf(rev.created_by)}` : ''}
                        {' · '}{new Date(rev.created_at).toLocaleString()}
                      </Text>
                    </Text>
                  </View>
                ) : null}
                {multiRound ? (
                  <Text style={{ fontSize: 12, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink3 }}>
                    Round {rn}{rn > 1 ? ' — revision' : ''}
                  </Text>
                ) : null}
                {rSteps.map((s) => (
                  <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <View style={{ flexShrink: 1 }}>
                      <Text style={{ fontSize: 14, color: s.status !== 'pending' ? t.ink3 : t.ink, textDecorationLine: s.status !== 'pending' ? 'line-through' : 'none' }}>
                        {s.ord}. {s.label}
                      </Text>
                      {s.office ? <Text style={{ fontSize: 12, color: t.ink3 }}>{s.office}</Text> : null}
                      {s.note ? <Text style={{ fontSize: 12, color: t.ink3 }}>note: {s.note}</Text> : null}
                    </View>
                    {s.status === 'pending' ? (
                      canWrite ? (
                        <View style={{ flexDirection: 'row', gap: 4, flexShrink: 0 }}>
                          <Pressable accessibilityRole="button" style={miniBtn}
                                     onPress={() => advance.mutate({ stepId: s.id, status: 'signed' })}>
                            <Text style={{ fontSize: 12, color: t.ink2, fontWeight: '700' }}>Sign</Text>
                          </Pressable>
                          <Pressable accessibilityRole="button" style={[miniBtn, { backgroundColor: 'transparent', borderWidth: 0 }]}
                                     onPress={() => { setSkipStep(s); setSkipNote(''); }}>
                            <Text style={{ fontSize: 12, color: t.ink2 }}>Skip</Text>
                          </Pressable>
                          <Pressable accessibilityRole="button" accessibilityLabel={`Send back for revision at ${s.label}`}
                                     style={[miniBtn, { backgroundColor: 'transparent', borderWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 3 }]}
                                     onPress={() => openRevision(s)}>
                            <Undo2 size={12} color={t.ink2} /><Text style={{ fontSize: 12, color: t.ink2 }}>Back</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Chip kind="pending" label="awaiting signature" />
                      )
                    ) : (
                      <Chip kind={stepChip(s).kind} label={stepChip(s).label} />
                    )}
                  </View>
                ))}
              </View>
            );
          })}
        </View>
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
          The paper needs changes. Pick which offices must sign again — the new round
          is appended to the log, nothing is overwritten.
        </Text>
        <Field label="What needs changing? (required)"
               hint="This becomes the note in the log — be specific.">
          <Input value={revNote} onChangeText={setRevNote} placeholder="revise page 3 — budget table" />
        </Field>
        {resolvedSteps.length > 0 ? (
          <Field label="Re-sign needed from:">
            <View style={{ gap: 2 }}>
              {resolvedSteps.map((s) => (
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
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          {revStep === 'late'
            ? 'The paper re-routes through the checked offices as a new round.'
            : `The paper re-routes through the checked offices, then returns to ${revStep?.label}.`}
        </Text>
        <Button style={{ width: '100%' }} onPress={() => revise.mutate()}
                disabled={!revNote.trim() || (revStep === 'late' && resend.size === 0) || revise.isPending} busy={revise.isPending}>
          Send back
        </Button>
      </Sheet>

      <Sheet open={!!editMv} onClose={() => setEditMv(null)} title="Edit movement">
        <Field label="Where is it now?"><Input value={location} onChangeText={setLocation} /></Field>
        <Field label="Note (optional)"><Input value={note} onChangeText={setNote} /></Field>
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          Photos can't be changed on a movement — delete and re-record to swap a photo.
        </Text>
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
