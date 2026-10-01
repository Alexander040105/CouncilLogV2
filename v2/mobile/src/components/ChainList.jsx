/** Flat-list alternative to ChainFlow — one row per desk, grouped by round
 *  with revision banners (the original pre-cards look). Resolved rows show who
 *  signed and when, plus movement/photo evidence pinned to that step. */
import { Pressable, Text, View } from 'react-native';
import { Camera, Undo2 } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { Chip } from './ui';
import { fmtTime, MovementThumb, STATUS } from './ChainFlow';

export function ChainList({ steps, revisions, movements, currentRound,
                            nameOf, canWrite, onSign, onSkip, onSendBack, onReturnTo, docId }) {
  const { t } = useTheme();
  const rounds = [...new Set(steps.map((s) => s.round_no))].sort((a, b) => a - b);
  const byStep = new Map();
  for (const m of movements ?? []) {
    if (!m.step_id) continue;
    if (!byStep.has(m.step_id)) byStep.set(m.step_id, []);
    byStep.get(m.step_id).push(m);
  }

  const miniBtn = {
    minHeight: 36, paddingHorizontal: 10, justifyContent: 'center',
    borderRadius: t.radiusInput, borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor,
    backgroundColor: t.surface3, flexDirection: 'row', alignItems: 'center', gap: 4,
  };
  const ghostBtn = { ...miniBtn, backgroundColor: 'transparent', borderWidth: 0 };

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
            {rSteps.map((s) => {
              const meta = STATUS[s.status] ?? STATUS.pending;
              const resolved = s.status !== 'pending';
              const pinned = byStep.get(s.id) ?? [];
              const canReturn = rn === currentRound && ['signed', 'skipped'].includes(s.status);
              return (
                <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flexShrink: 1, gap: 2 }}>
                    <Text style={{
                      fontSize: 14, color: resolved ? t.ink3 : t.ink,
                      textDecorationLine: resolved ? 'line-through' : 'none',
                    }}>
                      {s.ord}. {s.label}
                    </Text>
                    {s.office ? <Text style={{ fontSize: 12, color: t.ink3 }}>{s.office}</Text> : null}
                    {s.note ? <Text style={{ fontSize: 12, color: t.ink3 }}>note: {s.note}</Text> : null}
                    {s.signed_at ? (
                      <Text style={{ fontSize: 12, color: t.ink3 }}>
                        {nameOf(s.noted_by) ? `${nameOf(s.noted_by)} · ` : ''}{fmtTime(s.signed_at)}
                      </Text>
                    ) : null}
                    {pinned.map((m) => (
                      <View key={m.id} style={{ marginTop: 4 }}>
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
                  {s.status === 'pending' ? (
                    canWrite ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, flexShrink: 0 }}>
                        <Pressable accessibilityRole="button" style={miniBtn} onPress={() => onSign(s)}>
                          <Text style={{ fontSize: 12, color: t.ink2, fontWeight: '700' }}>Sign</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" style={ghostBtn} onPress={() => onSkip(s)}>
                          <Text style={{ fontSize: 12, color: t.ink2 }}>Skip</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Send back for revision at ${s.label}`}
                                   style={ghostBtn} onPress={() => onSendBack(s)}>
                          <Undo2 size={12} color={t.ink2} /><Text style={{ fontSize: 12, color: t.ink2 }}>Send back</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Chip kind={meta.chip} icon={<meta.Icon size={11} color={t.ink2} />} label={meta.label} />
                    )
                  ) : (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 0 }}>
                      <Chip kind={meta.chip} icon={<meta.Icon size={11} color={t.ink2} />} label={meta.label} />
                      {canReturn && canWrite ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Return to ${s.label} — they sign again`}
                                   style={ghostBtn} onPress={() => onReturnTo(s)}>
                          <Undo2 size={12} color={t.ink2} /><Text style={{ fontSize: 12, color: t.ink2 }}>Sign again</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
