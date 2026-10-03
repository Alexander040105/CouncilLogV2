/** "A new version is ready" banner — floats above the tab bar on every
 *  screen. Checks for an OTA on mount and each time the app returns to
 *  the foreground; the update downloads silently and the user picks when
 *  to restart — it never reloads on its own mid-task. Dismissal lasts
 *  for the session; it reappears next launch until applied.
 *
 *  When the release notes are known (updates.json on the web origin), a
 *  "What's new" list expands under the title so the user sees *why* the
 *  update exists before restarting. 'minor' releases never reach this
 *  component — they apply silently on the next cold start. */
import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { checkForUpdate, restartToUpdate } from '../lib/updates';

const MAX_NOTES = 6;

export function UpdateBanner() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const check = async () => {
      const r = await checkForUpdate();
      if (r.status === 'ready') setResult(r);
    };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, []);

  if (result?.status !== 'ready' || dismissed) return null;
  const notes = Array.isArray(result.notes) ? result.notes.slice(0, MAX_NOTES) : [];

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 72,
        borderRadius: t.radiusCard, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor,
        backgroundColor: t.surface3, paddingVertical: 8, paddingHorizontal: 12, gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
      {notes.length > 0 && (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? "Hide what's new" : "Show what's new"}
            onPress={() => setExpanded((e) => !e)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, marginLeft: 23 }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: t.ink2 }}>What’s new</Text>
            {expanded ? <ChevronUp size={13} color={t.ink3} /> : <ChevronDown size={13} color={t.ink3} />}
          </Pressable>
          {expanded && (
            <View style={{ marginLeft: 23, gap: 3, paddingBottom: 2 }}>
              {notes.map((n, i) => (
                <Text key={i} style={{ fontSize: 12, color: t.ink2 }}>{`• ${n}`}</Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
