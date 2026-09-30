/** Port of web ChecklistPreview — live preview of the checklist a new project
 *  would get, so the owner sees which templates + rules fire before saving. */
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../lib/theme';
import { describeReason, diagnoseChecklist } from '../lib/rules';

export function ChecklistPreview({ templates, paper, logistics, eventType, flags = {}, targetDate }) {
  const router = useRouter();
  const { t } = useTheme();
  if (!templates) return null;
  const { reason, items } = diagnoseChecklist(templates, {
    paper, logistics, eventType, flags, targetDate,
  });
  const n = items.length;
  return (
    <View style={{
      borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor,
      backgroundColor: t.surface2, padding: 12, gap: 4,
    }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>
        {n === 0 ? 'No checklist items' : `${n} checklist item${n === 1 ? '' : 's'}`} on save
      </Text>
      {n === 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 12, color: t.ink3 }}>{describeReason(reason) ?? 'No templates match this project.'} </Text>
          <Pressable accessibilityRole="link" onPress={() => router.push('/guide')} style={{ minHeight: 24, justifyContent: 'center' }}>
            <Text style={{ fontSize: 12, color: t.brand, textDecorationLine: 'underline' }}>How matching works</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ marginLeft: 12, gap: 2 }}>
          {items.map((i, k) => (
            <Text key={k} style={{ fontSize: 12, color: t.ink2 }}>
              • {i.label}
              <Text style={{ color: t.ink3 }}> — {i.template_name}</Text>
              {i.due ? <Text style={{ color: t.ink3 }}> · Due {i.due}</Text> : null}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
