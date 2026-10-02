/** Mobile port of web ChainFlow — signatory chain as process cards joined by
 *  down-arrows (vertical only on phones). Each card carries status, who/when,
 *  and movement+photo evidence pinned to that step. The custody timeline on
 *  the page stays the append-only record. */
import { Image, Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, Ban, Camera, CheckCircle2, Clock, SkipForward, Undo2 } from 'lucide-react-native';
import { get } from '../lib/api';
import { useOrgId } from '../lib/org';
import { useTheme } from '../lib/theme';
import { Chip } from './ui';

export const STATUS = {
  pending:            { chip: 'pending', label: 'awaiting signature', Icon: Clock },
  signed:             { chip: 'done',    label: 'signed',             Icon: CheckCircle2 },
  skipped:            { chip: 'skip',    label: 'skipped',            Icon: SkipForward },
  revision_requested: { chip: 'alert',   label: 'sent back',          Icon: Undo2 },
  superseded:         { chip: 'neutral', label: 'superseded',         Icon: Ban },
};

export const fmtTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

/** Signed-URL thumbnail for a movement's attached photo — lazy per photo. */
export function MovementThumb({ docId, movement }) {
  const org = useOrgId();
  const { t } = useTheme();
  const q = useQuery({
    queryKey: ['mv-photo', org, movement.id],
    queryFn: () => get(`/orgs/${org}/documents/${docId}/movements/${movement.id}/photo`),
    staleTime: 60_000,
  });
  if (!q.data?.url) return null;
  return (
    <Image
      source={{ uri: q.data.url }}
      accessibilityLabel={`Photo at ${movement.location_text}`}
      style={{ height: 96, width: '100%', borderRadius: t.radiusInput, marginTop: 4,
               borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor }}
      resizeMode="cover"
    />
  );
}

function StepCard({ s, isCurrent, live, pinned, nameOf, canWrite, onSign, onSkip, onSendBack, onReturnTo, docId, t }) {
  const meta = STATUS[s.status] ?? STATUS.pending;
  const done = ['signed', 'skipped', 'revision_requested', 'superseded'].includes(s.status);
  // a signed/skipped desk in the live round can be sent back to — the office
  // re-signs in a new round; history rows (superseded) stay read-only
  const canReturn = live && ['signed', 'skipped'].includes(s.status);
  const miniBtn = {
    minHeight: 36, paddingHorizontal: 10, justifyContent: 'center',
    borderRadius: t.radiusInput, borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor,
    backgroundColor: t.surface3, flexDirection: 'row', alignItems: 'center', gap: 4,
  };
  return (
    <View style={{
      flex: 1, borderRadius: t.radiusCard, backgroundColor: t.surface2, padding: 12, gap: 6,
      borderWidth: isCurrent ? 2 : Math.max(t.boxWidth, 1),
      borderColor: isCurrent ? t.brand : t.boxColor,
      opacity: done && !isCurrent ? 0.75 : 1,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>{s.ord}. {s.label}</Text>
          {s.office ? <Text style={{ fontSize: 12, color: t.ink3 }}>{s.office}</Text> : null}
        </View>
        <Chip kind={meta.chip} icon={<meta.Icon size={11} color={t.ink2} />} label={meta.label} />
      </View>

      {isCurrent ? (
        <Text style={{ fontSize: 11, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.brand }}>
          Current desk
        </Text>
      ) : null}

      <View style={{ gap: 2 }}>
        {s.signed_at ? (
          <Text style={{ fontSize: 12, color: t.ink3 }}>
            {nameOf(s.noted_by) ? `${nameOf(s.noted_by)} · ` : ''}{fmtTime(s.signed_at)}
          </Text>
        ) : null}
        {s.note ? <Text style={{ fontSize: 12, color: t.ink3 }}>Note: {s.note}</Text> : null}
      </View>

      {pinned.length > 0 ? (
        <View style={{ gap: 6, borderTopWidth: Math.max(t.boxWidth, 1), borderTopColor: t.boxColor, paddingTop: 8 }}>
          {pinned.map((m) => (
            <View key={m.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Camera size={11} color={t.ink3} />
                <Text style={{ fontSize: 12, color: t.ink3, flexShrink: 1 }}>
                  {m.location_text} · {fmtTime(m.created_at)}
                  {nameOf(m.moved_by) ? ` · ${nameOf(m.moved_by)}` : ''}
                </Text>
              </View>
              {m.note ? <Text style={{ fontSize: 12, color: t.ink2 }}>{m.note}</Text> : null}
              {m.photo_path ? <MovementThumb docId={docId} movement={m} /> : null}
            </View>
          ))}
        </View>
      ) : null}

      {s.status === 'pending' && isCurrent && canWrite ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          <Pressable accessibilityRole="button" style={miniBtn} onPress={() => onSign(s)}>
            <Text style={{ fontSize: 12, color: t.ink2, fontWeight: '700' }}>Sign</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={[miniBtn, { backgroundColor: 'transparent', borderWidth: 0 }]}
                     onPress={() => onSkip(s)}>
            <Text style={{ fontSize: 12, color: t.ink2 }}>Skip</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Send back for revision at ${s.label}`}
                     style={[miniBtn, { backgroundColor: 'transparent', borderWidth: 0 }]}
                     onPress={() => onSendBack(s)}>
            <Undo2 size={12} color={t.ink2} /><Text style={{ fontSize: 12, color: t.ink2 }}>Send back</Text>
          </Pressable>
        </View>
      ) : null}
      {canReturn && canWrite ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Return to ${s.label} — they sign again`}
                     style={[miniBtn, { backgroundColor: 'transparent', borderWidth: 0 }]}
                     onPress={() => onReturnTo(s)}>
            <Undo2 size={12} color={t.ink2} /><Text style={{ fontSize: 12, color: t.ink2 }}>Sign again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function ChainFlow({ steps, revisions, movements, currentRound,
                            nameOf, canWrite, onSign, onSkip, onSendBack, onReturnTo, docId }) {
  const { t } = useTheme();
  const rounds = [...new Set(steps.map((s) => s.round_no))].sort((a, b) => a - b);
  const byStep = new Map();
  for (const m of movements ?? []) {
    if (!m.step_id) continue;
    if (!byStep.has(m.step_id)) byStep.set(m.step_id, []);
    byStep.get(m.step_id).push(m);
  }

  return (
    <View style={{ gap: 12 }}>
      {rounds.map((rn) => {
        const rSteps = steps.filter((s) => s.round_no === rn);
        const rev = (revisions ?? []).find((r) => r.round_no === rn);
        return (
          <View key={rn} style={{ gap: 8 }}>
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
                    {' · '}{fmtTime(rev.created_at)}
                  </Text>
                </Text>
              </View>
            ) : null}
            {rounds.length > 1 ? (
              <Text style={{ fontSize: 12, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink3 }}>
                Round {rn}{rn > 1 ? ' — revision' : ''}
              </Text>
            ) : null}
            {rSteps.map((s, i) => (
              <View key={s.id} style={{ gap: 4 }}>
                {i > 0 ? (
                  <View style={{ alignItems: 'center', paddingVertical: 2 }}>
                    <ArrowDown size={18} color={t.ink3} />
                  </View>
                ) : null}
                <StepCard
                  s={s}
                  isCurrent={s.status === 'pending' && rn === currentRound}
                  live={rn === currentRound}
                  pinned={byStep.get(s.id) ?? []}
                  nameOf={nameOf}
                  canWrite={canWrite}
                  onSign={onSign} onSkip={onSkip} onSendBack={onSendBack}
                  onReturnTo={onReturnTo}
                  docId={docId}
                  t={t}
                />
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
