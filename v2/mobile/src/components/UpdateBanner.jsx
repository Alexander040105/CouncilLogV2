/** "A new version is ready" banner — floats above the tab bar on every
 *  screen. Checks for an OTA on mount and each time the app returns to
 *  the foreground; the update downloads silently and the user picks when
 *  to restart — it never reloads on its own mid-task. Dismissal lasts
 *  for the session; it reappears next launch until applied. */
import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshCw, X } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { checkForUpdate, restartToUpdate } from '../lib/updates';

export function UpdateBanner() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const check = async () => {
      if ((await checkForUpdate()) === 'ready') setReady(true);
    };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, []);

  if (!ready || dismissed) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 72,
        flexDirection: 'row', alignItems: 'center', gap: 8,
        borderRadius: t.radiusCard, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor,
        backgroundColor: t.surface3, paddingVertical: 8, paddingHorizontal: 12,
      }}
    >
      <RefreshCw size={15} color={t.brand} />
      <Text style={{ flex: 1, fontSize: 13, color: t.ink }}>A new version is ready.</Text>
      <Pressable
        accessibilityRole="button"
        disabled={restarting}
        onPress={async () => { setRestarting(true); await restartToUpdate().catch(() => setRestarting(false)); }}
        style={{
          minHeight: 44, justifyContent: 'center', paddingHorizontal: 14,
          borderRadius: t.radiusInput, backgroundColor: t.accent,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: t.accentFg }}>
          {restarting ? 'Restarting…' : 'Restart'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button" accessibilityLabel="Update later"
        onPress={() => setDismissed(true)}
        style={{ minHeight: 36, minWidth: 36, alignItems: 'center', justifyContent: 'center' }}
      >
        <X size={15} color={t.ink3} />
      </Pressable>
    </View>
  );
}
