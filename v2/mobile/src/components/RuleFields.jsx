/** Mobile port of web RuleFields — same (mode, condValue) → rule_json
 *  serializers; Select replaces <select>, suggestion chips replace datalist. */
import { Pressable, Text, View } from 'react-native';
import { CheckRow, Field, Input, Select } from './ui';
import { useTheme } from '../lib/theme';
import { humanizeFlag } from '../lib/rules';

export const WHEN_ALWAYS = 'always';

export function whenFromJson(rule) {
  if (rule?.include_if_event_type != null) return { mode: 'event', condValue: rule.include_if_event_type };
  if (rule?.exclude_if_event_type != null) return { mode: 'not_event', condValue: rule.exclude_if_event_type };
  if (rule?.include_if_flag != null) return { mode: 'flag', condValue: rule.include_if_flag };
  return { mode: WHEN_ALWAYS, condValue: '' };
}

export function dueFromJson(rule) {
  if (rule?.due_days_before_event != null) return { dueMode: 'before', dueN: String(rule.due_days_before_event) };
  if (rule?.due_days_after_event != null) return { dueMode: 'after', dueN: String(rule.due_days_after_event) };
  return { dueMode: '', dueN: '' };
}

/** (mode, condValue) → the condition half of a rule object. */
export function whenToJson(mode, condValue) {
  const v = String(condValue ?? '').trim();
  if (mode === 'event' && v) return { include_if_event_type: v };
  if (mode === 'not_event' && v) return { exclude_if_event_type: v };
  if (mode === 'flag' && v) return { include_if_flag: v };
  return {};
}

/** (dueMode, dueN) → the due half of a rule object (items only). */
export function dueToJson(dueMode, dueN) {
  const n = parseInt(dueN, 10);
  if (!Number.isFinite(n) || n <= 0) return {};
  if (dueMode === 'before') return { due_days_before_event: n };
  if (dueMode === 'after') return { due_days_after_event: n };
  return {};
}

/** Free-text input + tap-to-fill suggestion chips (datalist equivalent). */
function SuggestInput({ value, onChange, suggestions, placeholder }) {
  const { t } = useTheme();
  return (
    <View style={{ gap: 6, flex: 1 }}>
      <Input value={value} onChangeText={onChange} placeholder={placeholder} autoCapitalize="none" />
      {suggestions.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {suggestions.map((s) => (
            <Pressable key={s} accessibilityRole="button" onPress={() => onChange(s)}
                       style={{
                         minHeight: 32, justifyContent: 'center', paddingHorizontal: 10,
                         borderRadius: t.chipRadius, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor,
                         backgroundColor: value === s ? t.accent : t.surface2,
                       }}>
              <Text style={{ fontSize: 12, color: value === s ? t.accentFg : t.ink2 }}>{humanizeFlag(s)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** "When does this apply" — always / only event type / not event type /
 *  only when flag. allowExclude=false drops the not-for option (chains). */
export function WhenSelect({ mode, condValue, onMode, onCondValue, eventTypes = [], flagNames = [], allowExclude = true }) {
  return (
    <View style={{ gap: 8 }}>
      <Select
        value={mode}
        onChange={onMode}
        accessibilityLabel="When does this apply"
        options={[
          { value: WHEN_ALWAYS, label: 'always' },
          { value: 'event', label: 'only for event type…' },
          ...(allowExclude ? [{ value: 'not_event', label: 'not for event type…' }] : []),
          { value: 'flag', label: 'only when flag…' },
        ]}
      />
      {mode !== WHEN_ALWAYS ? (
        <SuggestInput
          value={condValue}
          onChange={onCondValue}
          suggestions={(mode === 'flag' ? flagNames : eventTypes).filter((s) => s !== condValue)}
          placeholder={mode === 'flag' ? 'e.g. off_campus' : 'e.g. webinar_intl'}
        />
      ) : null}
    </View>
  );
}

/** Optional due-date rule for checklist items. */
export function DueSelect({ dueMode, dueN, onMode, onN }) {
  return (
    <View style={{ gap: 8 }}>
      <Select
        value={dueMode}
        onChange={onMode}
        accessibilityLabel="Due date rule"
        options={[
          { value: '', label: 'no due date' },
          { value: 'before', label: 'due N days before the event' },
          { value: 'after', label: 'due N days after the event' },
        ]}
      />
      {dueMode ? (
        <Input keyboardType="numeric" value={String(dueN ?? '')} onChangeText={onN}
               placeholder="15" accessibilityLabel="Number of days" style={{ width: 96 }} />
      ) : null}
    </View>
  );
}

/** One checkbox per flag name in use across the org's chains/templates —
 *  renders nothing when nothing references a flag. */
export function FlagCheckboxes({ flagNames = [], value = {}, onChange, label = 'This is…', hint }) {
  if (!flagNames.length) return null;
  const toggle = (name, on) => onChange({ ...value, [name]: on });
  return (
    <Field label={label}
           hint={hint ?? 'These checkboxes exist because a template or chain looks for them — tick every one that applies.'}>
      <View style={{ gap: 2 }}>
        {flagNames.map((f) => (
          <CheckRow key={f} checked={!!value[f]} onChange={(on) => toggle(f, on)} label={humanizeFlag(f)} />
        ))}
      </View>
    </Field>
  );
}
