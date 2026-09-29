/** Offline/sync strip — mounted once inside Screen so every page gets it.
 *  States: offline (+queued count) / sending / dead-letter needs attention.
 *  Tap → /pending to review the queue. */
import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { useRouter } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { queueCounts, subscribeOutbox } from '../lib/offline';
import { useTheme } from '../lib/theme';

export function SyncBanner() {
  const { t } = useTheme();
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [counts, setCounts] = useState(() => queueCounts());

  useEffect(() => {
    const unsubNet = NetInfo.addEventListener((s) => {
      setOnline(Boolean(s.isConnected) && s.isInternetReachable !== false);
    });
    const unsubBox = subscribeOutbox(() => setCounts({ ...queueCounts() }));
    return () => { unsubNet(); unsubBox(); };
  }, []);

  const queued = counts.pending + counts.sending;
  const dead = counts.dead;

  let icon = null;
  let text = null;
  let color = null;
  if (dead > 0) {
    icon = <TriangleAlert size={13} color={t.alert} />;
    text = `${dead} change${dead === 1 ? '' : 's'} couldn't send — tap to review`;
    color = t.alert;
  } else if (!online) {
    icon = <CloudOff size={13} color={t.ink2} />;
    text = queued > 0
      ? `You're offline — ${queued} change${queued === 1 ? '' : 's'} will send when you're back`
      : 'You’re offline — new changes will be saved on this device';
    color = t.ink2;
  } else if (queued > 0) {
    icon = <RefreshCw size={13} color={t.ink2} />;
    text = `Sending ${queued} queued change${queued === 1 ? '' : 's'}…`;
    color = t.ink2;
  } else {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${text}`}
      onPress={() => router.push('/pending')}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 12, paddingVertical: 6,
        borderBottomWidth: Math.max(t.boxWidth, 1),
        borderBottomColor: dead > 0 ? t.alert : t.boxColor,
        backgroundColor: t.surface2,
      }}
    >
      {icon}
      <Text style={{ flex: 1, fontSize: 12, color }}>{text}</Text>
    </Pressable>
  );
}
