/** Pending changes — the offline outbox made visible. Queued writes replay
 *  automatically when connectivity returns; dead ones need a retry or discard. */
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Camera, Check, ListChecks, RefreshCw, RotateCcw, Trash2 } from 'lucide-react-native';
import { listOps, discardOp, replayQueue, retryOp, subscribeOutbox } from '../src/lib/offline';
import { useTheme } from '../src/lib/theme';
import { Button, Card, Chip, Empty, PageHeader, Screen } from '../src/components/ui';

/** Human-readable label for a queued op — the reader isn't a developer. */
function opLabel(op) {
  if (op.kind === 'photo_record') {
    const info = JSON.parse(op.body);
    if (info.record_path.includes('/journal')) return 'Journal entry + photo';
    if (info.record_path.includes('/movements')) return 'Paper movement + photo';
    return 'Photo record';
  }
  const p = op.path;
  const what =
    p.includes('/journal') ? 'Journal entry'
    : p.includes('/movements') ? 'Paper movement'
    : p.includes('/documents') ? 'Document'
    : p.includes('/checklist') ? 'Checklist item'
    : p.includes('/tasks') ? 'Task'
    : p.includes('/attendance') ? 'Attendance'
    : p.includes('/projects') ? 'Project'
    : p.includes('/push-tokens') ? 'Notification registration'
    : 'Change';
  const verb = op.method === 'POST' ? 'Save'
    : op.method === 'PATCH' || op.method === 'PUT' ? 'Update'
    : op.method === 'DELETE' ? 'Delete' : 'Send';
  return `${verb}: ${what}`;
}

function opDetail(op) {
  try {
    const b = op.kind === 'photo_record' ? JSON.parse(op.body).record_body : JSON.parse(op.body ?? 'null');
    return b?.description ?? b?.title ?? b?.location_text ?? b?.label ?? null;
  } catch { return null; }
}

const STATUS_CHIP = {
  pending: { kind: 'pending', label: 'queued' },
  sending: { kind: 'neutral', label: 'sending…' },
  dead: { kind: 'alert', label: 'needs attention' },
};

export default function Pending() {
  const { t } = useTheme();
  const router = useRouter();
  const [ops, setOps] = useState(() => listOps());
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeOutbox(() => setOps([...listOps()])), []);

  const live = ops.filter((o) => o.status === 'pending' || o.status === 'sending');
  const dead = ops.filter((o) => o.status === 'dead');

  const sendNow = async () => {
    setBusy(true);
    try { await replayQueue(); } finally { setBusy(false); }
  };

  const miniBtn = {
    minHeight: 36, paddingHorizontal: 10, justifyContent: 'center',
    borderRadius: t.radiusInput, borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor,
    backgroundColor: t.surface3, flexDirection: 'row', alignItems: 'center', gap: 4,
  };

  return (
    <Screen>
      <Pressable accessibilityRole="button" onPress={() => router.back()}
                 style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} color={t.ink3} /><Text style={{ fontSize: 14, color: t.ink3 }}>Back</Text>
      </Pressable>
      <PageHeader
        title="Pending changes"
        description="Things you did while offline send automatically when you're back online."
        action={live.length ? (
          <Button variant="secondary" onPress={sendNow} busy={busy} disabled={busy}>
            <RefreshCw size={14} color={t.ink2} /><Text style={{ color: t.ink2, fontWeight: '700' }}>Send now</Text>
          </Button>
        ) : null}
      />

      {ops.length === 0 ? (
        <Empty icon={<Check size={24} color={t.ink3} />} title="All caught up"
               hint="Nothing waiting — every change has reached the server." />
      ) : null}

      {dead.length > 0 ? (
        <Card style={{ gap: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.alert }}>
            Needs attention
          </Text>
          {dead.map((op) => (
            <View key={op.op_id} style={{ gap: 6, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink, flexShrink: 1 }}>{opLabel(op)}</Text>
                <Chip {...STATUS_CHIP.dead} />
              </View>
              {opDetail(op) ? <Text style={{ fontSize: 12, color: t.ink2 }}>{opDetail(op)}</Text> : null}
              {op.error ? <Text style={{ fontSize: 12, color: t.alert }}>{op.error}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable accessibilityRole="button" style={miniBtn} onPress={() => retryOp(op.op_id)}>
                  <RotateCcw size={12} color={t.ink2} /><Text style={{ fontSize: 12, color: t.ink2, fontWeight: '700' }}>Retry</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Discard change"
                           style={[miniBtn, { borderColor: t.alert, backgroundColor: 'transparent' }]}
                           onPress={() => discardOp(op.op_id)}>
                  <Trash2 size={12} color={t.alert} /><Text style={{ fontSize: 12, color: t.alert }}>Discard</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {live.length > 0 ? (
        <Card style={{ gap: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>
            Waiting to send
          </Text>
          {live.map((op) => (
            <View key={op.op_id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 8 }}>
              <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {op.kind === 'photo_record' ? <Camera size={14} color={t.ink3} /> : <ListChecks size={14} color={t.ink3} />}
                <View>
                  <Text style={{ fontSize: 14, color: t.ink }}>{opLabel(op)}</Text>
                  {opDetail(op) ? <Text style={{ fontSize: 12, color: t.ink3 }} numberOfLines={1}>{opDetail(op)}</Text> : null}
                </View>
              </View>
              <Chip {...STATUS_CHIP[op.status]} />
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
