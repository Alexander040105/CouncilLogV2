/** What's new — release history, bundled with the app so it works fully
 *  offline. The running bundle always carries the notes for every release
 *  up to and including itself; the hosted copy (web/public/updates.json)
 *  is what the update banner reads before a restart. */
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Sparkles } from 'lucide-react-native';
import { useTheme } from '../src/lib/theme';
import { Card, PageHeader, Screen } from '../src/components/ui';
import data from '../src/lib/changelog-data.json';

function niceDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function WhatsNew() {
  const router = useRouter();
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const entries = Array.isArray(data?.updates) ? data.updates : [];

  const header = (
    <View style={{ gap: 14, marginBottom: 6 }}>
      <Pressable accessibilityRole="button" onPress={() => router.back()}
                 style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} color={t.ink3} /><Text style={{ fontSize: 14, color: t.ink3 }}>Back</Text>
      </Pressable>
      <PageHeader title="What's new" description="Everything we've shipped lately." />
    </View>
  );

  return (
    <Screen scroll={false} pad={0}>
      <FlatList
        style={{ flex: 1 }}
        data={entries}
        keyExtractor={(e, i) => `${e.date}-${i}`}
        renderItem={({ item: e, index }) => (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: t.ink }}>{niceDate(e.date)}</Text>
              {index === 0 && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
                  backgroundColor: t.accent,
                }}>
                  <Sparkles size={11} color={t.accentFg} />
                  <Text style={{ fontSize: 11, fontWeight: '700', color: t.accentFg }}>Latest</Text>
                </View>
              )}
            </View>
            <View style={{ marginTop: 8, gap: 4 }}>
              {(e.notes ?? []).map((n, i) => (
                <Text key={i} style={{ fontSize: 13, color: t.ink2 }}>{`• ${n}`}</Text>
              ))}
            </View>
          </Card>
        )}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom + 72 }}
      />
    </Screen>
  );
}
