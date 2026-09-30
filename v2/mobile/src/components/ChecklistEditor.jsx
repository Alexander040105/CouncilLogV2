/** Mobile port of web ChecklistEditor — editable checklist snapshot for a
 *  project being created. Templates pre-check from the paper/logistics
 *  toggles but stay freely adjustable; every item row is editable. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react-native';
import { describeReason, matchedTemplates, templateItems } from '../lib/rules';
import { humanize } from '../lib/labels';
import { useTheme } from '../lib/theme';
import { Button, CheckRow, Input, Skeleton } from './ui';

export function ChecklistEditor({ templates, paper, logistics, eventType,
                                  flags = {}, targetDate, items, onItems }) {
  const { t } = useTheme();
  const ctx = { eventType: eventType || null, flags, targetDate: targetDate || null };

  const [selected, setSelected] = useState(() => new Set());
  const [removed, setRemoved] = useState(() => new Set());
  const autoRef = useRef(new Set());
  const customN = useRef(0);

  // toggles re-suggest; manually added selections persist
  useEffect(() => {
    if (!templates) return;
    const matched = matchedTemplates(templates, { paper, logistics, eventType: ctx.eventType });
    const auto = new Set(matched.map((x) => x.id));
    setSelected((prev) => {
      const manual = [...prev].filter((id) => !autoRef.current.has(id));
      return new Set([...auto, ...manual]);
    });
    autoRef.current = auto;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, logistics, eventType, templates]);

  const base = useMemo(() => {
    if (!templates) return [];
    return templates
      .filter((x) => selected.has(x.id))
      .flatMap((x) => templateItems(x, ctx).map((i) => ({
        key: `${x.id}:${i.id}`, label: i.label, hint: i.hint ?? null,
        required: i.required ?? true, due_date: i.due ?? null, from: x.name,
      })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, selected, eventType, flags, targetDate]);

  useEffect(() => {
    const fresh = new Map(base.map((i) => [i.key, i]));
    const kept = items.filter((i) => i.custom || (fresh.has(i.key) && !removed.has(i.key)));
    const keptKeys = new Set(kept.map((i) => i.key));
    const appended = base.filter((i) => !keptKeys.has(i.key) && !removed.has(i.key));
    const next = [...kept, ...appended];
    if (JSON.stringify(next) !== JSON.stringify(items)) onItems(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, removed]);

  if (!templates) return <Skeleton style={{ height: 128 }} />;

  const setItem = (key, p) =>
    onItems(items.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const removeItem = (key) => {
    setRemoved((prev) => new Set([...prev, key]));
    onItems(items.filter((i) => i.key !== key));
  };
  const move = (idx, dir) => {
    const next = [...items];
    const [x] = next.splice(idx, 1);
    next.splice(idx + dir, 0, x);
    onItems(next);
  };
  const addCustom = () => {
    customN.current += 1;
    onItems([...items, {
      key: `custom:${customN.current}`, label: '', hint: null,
      required: true, due_date: null, from: null, custom: true,
    }]);
  };
  const reset = () => {
    setRemoved(new Set());
    customN.current = 0;
    onItems(base);
  };
  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const trackChip = { paper: 'Papers', logistics: 'Logistics', both: 'Papers + logistics' };
  const iconBtn = {
    minHeight: 36, minWidth: 36, alignItems: 'center', justifyContent: 'center',
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>
          Checklist templates
        </Text>
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          Ticked automatically from your paper/logistics picks — adjust freely,
          then edit the items below.
        </Text>
        {templates.length === 0 ? (
          <Text style={{ fontSize: 12, color: t.ink3 }}>{describeReason('no_templates')}</Text>
        ) : (
          <View style={{ gap: 2 }}>
            {templates.map((x) => (
              <CheckRow
                key={x.id}
                checked={selected.has(x.id)}
                onChange={() => toggle(x.id)}
                label={x.name}
                hint={`${trackChip[x.track] ?? humanize(x.track)}${x.event_type ? ` · ${humanize(x.event_type)}` : ''}`}
              />
            ))}
          </View>
        )}
      </View>

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>
            Checklist on save — {items.length} item{items.length === 1 ? '' : 's'}
          </Text>
          {removed.size > 0 ? (
            <Pressable accessibilityRole="button" onPress={reset}
                       style={{ minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <RotateCcw size={11} color={t.brand} />
              <Text style={{ fontSize: 12, color: t.brand }}>Restore removed</Text>
            </Pressable>
          ) : null}
        </View>
        {items.length === 0 ? (
          <Text style={{ fontSize: 12, color: t.ink3 }}>
            Nothing on the checklist — add a row below, or the project can still
            generate one later from its detail screen.
          </Text>
        ) : null}
        {items.map((it, idx) => (
          <View key={it.key} style={{
            borderRadius: t.radiusInput, borderWidth: Math.max(t.boxWidth, 1),
            borderColor: t.boxColor, backgroundColor: t.surface2, padding: 8, gap: 6,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ flex: 1 }}>
                <Input
                  value={it.label} placeholder="What needs doing?"
                  accessibilityLabel={`Item ${idx + 1} label`}
                  onChangeText={(v) => setItem(it.key, { label: v })}
                />
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Move item up"
                         disabled={idx === 0} style={[iconBtn, { opacity: idx === 0 ? 0.3 : 1 }]}
                         onPress={() => move(idx, -1)}>
                <ArrowUp size={15} color={t.ink3} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Move item down"
                         disabled={idx === items.length - 1}
                         style={[iconBtn, { opacity: idx === items.length - 1 ? 0.3 : 1 }]}
                         onPress={() => move(idx, 1)}>
                <ArrowDown size={15} color={t.ink3} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${it.label || 'item'}`}
                         style={iconBtn} onPress={() => removeItem(it.key)}>
                <Trash2 size={15} color={t.alert} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <View style={{ flexGrow: 1, minWidth: 140 }}>
                <Input
                  value={it.hint ?? ''} placeholder="Hint (optional)"
                  accessibilityLabel={`Item ${idx + 1} hint`}
                  style={{ fontSize: 12, minHeight: 36 }}
                  onChangeText={(v) => setItem(it.key, { hint: v || null })}
                />
              </View>
              <View style={{ minWidth: 130 }}>
                <Input
                  value={it.due_date ?? ''} placeholder="Due YYYY-MM-DD"
                  accessibilityLabel={`Item ${idx + 1} due date`}
                  autoCapitalize="none"
                  style={{ fontSize: 12, minHeight: 36 }}
                  onChangeText={(v) => setItem(it.key, { due_date: v || null })}
                />
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <CheckRow
                checked={it.required}
                onChange={(v) => setItem(it.key, { required: v })}
                label="Required"
              />
              {it.from ? <Text style={{ fontSize: 11, color: t.ink3 }}>from {it.from}</Text> : null}
            </View>
          </View>
        ))}
        <Button variant="secondary" style={{ width: '100%' }} onPress={addCustom}>
          <Plus size={14} color={t.ink} /><Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>Add item</Text>
        </Button>
      </View>
    </View>
  );
}
