/** Mobile port of TemplateEditor — name/track/scope + ordered item rows with
 *  hints, optional toggle, when-conditions, due rules, reorder. */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react-native';
import { patch, post } from '../lib/api';
import { useOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
import { useTheme } from '../lib/theme';
import { Button, CheckRow, Field, Input, Select, Sheet } from './ui';
import { DueSelect, WhenSelect, dueFromJson, dueToJson, whenFromJson, whenToJson } from './RuleFields';

const emptyRow = () => ({ label: '', hint: '', required: true, mode: 'always', condValue: '', dueMode: '', dueN: '' });

const rowFromItem = (it) => ({
  label: it.label, hint: it.hint ?? '', required: it.required !== false,
  ...whenFromJson(it.rule_json), ...dueFromJson(it.rule_json),
});

function serialize(rows) {
  return rows.filter((r) => r.label.trim()).map((r, i) => {
    const rule = { ...whenToJson(r.mode, r.condValue), ...dueToJson(r.dueMode, r.dueN) };
    return {
      ord: i + 1, label: r.label.trim(), hint: r.hint.trim() || null,
      required: r.required !== false,
      rule_json: Object.keys(rule).length ? rule : null,
    };
  });
}

const TRACKS = [
  { value: 'paper', label: 'paper — signatory-routed documents' },
  { value: 'logistics', label: 'logistics — venue, food, equipment' },
  { value: 'both', label: 'both — either kind of project' },
];

export function TemplateEditor({ open, onClose, template, eventTypes = [], flagNames = [] }) {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const editing = !!template?.id;
  const [name, setName] = useState('');
  const [track, setTrack] = useState('paper');
  const [evt, setEvt] = useState('');
  const [rows, setRows] = useState([emptyRow()]);

  const [formKey, setFormKey] = useState(null);
  const key = open ? (template?.id ?? 'new') : null;
  if (key !== formKey) {
    setFormKey(key);
    setName(template?.name ?? '');
    setTrack(template?.track ?? 'paper');
    setEvt(template?.event_type ?? '');
    setRows(template?.items?.length ? template.items.map(rowFromItem) : [emptyRow()]);
  }

  const setRow = (i, patchRow) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patchRow } : r)));
  const removeRow = (i) => setRows((rs) => rs.filter((_, k) => k !== i));
  const move = (i, dir) => setRows((rs) => {
    const j = i + dir;
    if (j < 0 || j >= rs.length) return rs;
    const next = [...rs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const iconBtn = {
    minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center',
  };

  const items = serialize(rows);
  const save = useMutation({
    mutationFn: () => (editing
      ? patch(`/orgs/${org}/checklist-templates/${template.id}`, {
          name: name.trim(), track, event_type: evt.trim() || null, items })
      : post(`/orgs/${org}/checklist-templates`, {
          name: name.trim(), track, event_type: evt.trim() || null, items })),
    onSuccess: () => {
      toast.success(editing ? 'Template updated.' : 'Template created.');
      onClose();
      qc.invalidateQueries({ queryKey: ['templates', org] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit template' : 'New template'}>
      <Field label="Template name" hint="What people see when picking checklists — e.g. Concept Paper Pack.">
        <Input value={name} onChangeText={setName} />
      </Field>
      <Field label="Track" hint="paper = signatory-routed docs · logistics = venue/equipment · both = applies to either">
        <Select value={track} onChange={setTrack} accessibilityLabel="Track" options={TRACKS} />
      </Field>
      <Field label="Event type (optional)" hint="Leave blank to match every event type — or scope this to one, e.g. webinar_intl.">
        <Input value={evt} onChangeText={setEvt} placeholder="any" autoCapitalize="none" />
        {eventTypes.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {eventTypes.map((et) => (
              <Pressable key={et} accessibilityRole="button" onPress={() => setEvt(et)}
                         style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 10, borderRadius: t.chipRadius, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor, backgroundColor: t.surface2 }}>
                <Text style={{ fontSize: 12, color: t.ink2 }}>{et}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Field>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Items, in order</Text>
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          Each becomes a checklist item on matching projects. Hints say where to go or what to watch for; optional items are reminders that don’t block.
        </Text>
        {rows.map((r, i) => (
          <View key={i} style={{ gap: 8, borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor, padding: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
              <Input style={{ flex: 1, minWidth: 0 }} placeholder={`Item ${i + 1}`} accessibilityLabel={`Item ${i + 1}`}
                     value={r.label} onChangeText={(v) => setRow(i, { label: v })} />
              <Pressable accessibilityLabel="Move item up" accessibilityRole="button" style={iconBtn}
                         disabled={i === 0} onPress={() => move(i, -1)}>
                <ArrowUp size={16} color={i === 0 ? t.ink3 : t.ink2} />
              </Pressable>
              <Pressable accessibilityLabel="Move item down" accessibilityRole="button" style={iconBtn}
                         disabled={i === rows.length - 1} onPress={() => move(i, 1)}>
                <ArrowDown size={16} color={i === rows.length - 1 ? t.ink3 : t.ink2} />
              </Pressable>
              <Pressable accessibilityLabel="Remove item" accessibilityRole="button" style={iconBtn}
                         onPress={() => removeRow(i)}>
                <X size={16} color={t.ink2} />
              </Pressable>
            </View>
            <Input placeholder="Hint (optional) — where to go, what to watch for" accessibilityLabel={`Hint for item ${i + 1}`}
                   value={r.hint} onChangeText={(v) => setRow(i, { hint: v })} />
            <WhenSelect mode={r.mode} condValue={r.condValue}
                        onMode={(m) => setRow(i, { mode: m, condValue: m === 'always' ? '' : r.condValue })}
                        onCondValue={(v) => setRow(i, { condValue: v })}
                        eventTypes={eventTypes} flagNames={flagNames} />
            <DueSelect dueMode={r.dueMode} dueN={r.dueN}
                       onMode={(m) => setRow(i, { dueMode: m })} onN={(v) => setRow(i, { dueN: v })} />
            <CheckRow checked={r.required === false} onChange={(on) => setRow(i, { required: !on })}
                      label="optional — a reminder, not a blocker" />
          </View>
        ))}
        <Button variant="secondary" onPress={() => setRows((rs) => [...rs, emptyRow()])}>
          <Plus size={16} color={t.ink} /><Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>Add item</Text>
        </Button>
      </View>

      <Button style={{ width: '100%' }} onPress={() => save.mutate()}
              disabled={!name.trim() || !items.length || save.isPending} busy={save.isPending}>
        {editing ? 'Save changes' : 'Create template'}
      </Button>
      <Text style={{ fontSize: 12, color: t.ink3 }}>
        Only future checklists use the new version — projects already generated keep their copies.
      </Text>
    </Sheet>
  );
}
