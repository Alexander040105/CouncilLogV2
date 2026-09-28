/** Mobile port of ChainEditor — name/doc_type + ordered step rows with
 *  office locations and optional conditions (event type or flag). */
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react-native';
import { patch, post } from '../lib/api';
import { useOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
import { useTheme } from '../lib/theme';
import { Button, Field, Input, Sheet } from './ui';
import { WhenSelect, whenFromJson, whenToJson } from './RuleFields';

const emptyRow = () => ({ label: '', office: '', mode: 'always', condValue: '' });

const rowFromStep = (s) => ({
  label: s.label, office: s.office ?? '', ...whenFromJson(s.condition_json),
});

function serialize(rows) {
  return rows.filter((r) => r.label.trim()).map((r, i) => {
    const cond = whenToJson(r.mode, r.condValue);
    return {
      ord: i + 1, label: r.label.trim(), office: r.office.trim() || null,
      condition_json: Object.keys(cond).length ? cond : null,
    };
  });
}

export function ChainEditor({ open, onClose, chain, docTypes = [], eventTypes = [], flagNames = [] }) {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const editing = !!chain?.id;
  const [name, setName] = useState('');
  const [docType, setDocType] = useState('');
  const [rows, setRows] = useState([emptyRow()]);

  useEffect(() => {
    if (!open) return;
    setName(chain?.name ?? '');
    setDocType(chain?.doc_type ?? '');
    setRows(chain?.steps?.length ? chain.steps.map(rowFromStep) : [emptyRow()]);
  }, [open, chain]);

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

  const steps = serialize(rows);
  const save = useMutation({
    mutationFn: () => (editing
      ? patch(`/orgs/${org}/signatory-chains/${chain.id}`, {
          name: name.trim(), doc_type: docType.trim(), steps })
      : post(`/orgs/${org}/signatory-chains`, {
          name: name.trim(), doc_type: docType.trim(), steps })),
    onSuccess: () => {
      toast.success(editing ? 'Chain updated.' : 'Chain created.');
      onClose();
      qc.invalidateQueries({ queryKey: ['chains', org] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit chain' : 'New chain'}>
      <Field label="Chain name" hint="e.g. Standard concept paper route — shown when a paper picks this chain.">
        <Input value={name} onChangeText={setName} />
      </Field>
      <Field label="Doc type" hint="Must match a document's type exactly — that's how papers pick this chain automatically.">
        <Input value={docType} onChangeText={setDocType} placeholder="concept_paper" autoCapitalize="none" />
        {docTypes.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {docTypes.map((x) => (
              <Pressable key={x} accessibilityRole="button" onPress={() => setDocType(x)}
                         style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 10, borderRadius: t.chipRadius, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor, backgroundColor: t.surface2 }}>
                <Text style={{ fontSize: 12, color: t.ink2 }}>{x}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Field>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Steps, in signing order</Text>
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          Each line is one desk the paper visits, top to bottom. Office = where the desk physically is. A condition means the step only applies some of the time.
        </Text>
        {rows.map((r, i) => (
          <View key={i} style={{ gap: 8, borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor, padding: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
              <Input style={{ flex: 1, minWidth: 0 }} placeholder={`Step ${i + 1} — who signs`} accessibilityLabel={`Step ${i + 1}`}
                     value={r.label} onChangeText={(v) => setRow(i, { label: v })} />
              <Pressable accessibilityLabel="Move step up" accessibilityRole="button" style={iconBtn}
                         disabled={i === 0} onPress={() => move(i, -1)}>
                <ArrowUp size={16} color={i === 0 ? t.ink3 : t.ink2} />
              </Pressable>
              <Pressable accessibilityLabel="Move step down" accessibilityRole="button" style={iconBtn}
                         disabled={i === rows.length - 1} onPress={() => move(i, 1)}>
                <ArrowDown size={16} color={i === rows.length - 1 ? t.ink3 : t.ink2} />
              </Pressable>
              <Pressable accessibilityLabel="Remove step" accessibilityRole="button" style={iconBtn}
                         onPress={() => removeRow(i)}>
                <X size={16} color={t.ink2} />
              </Pressable>
            </View>
            <Input placeholder="Office (optional) — e.g. 2nd floor hallway, left side" accessibilityLabel={`Office for step ${i + 1}`}
                   value={r.office} onChangeText={(v) => setRow(i, { office: v })} />
            <WhenSelect mode={r.mode} condValue={r.condValue}
                        onMode={(m) => setRow(i, { mode: m, condValue: m === 'always' ? '' : r.condValue })}
                        onCondValue={(v) => setRow(i, { condValue: v })}
                        eventTypes={eventTypes} flagNames={flagNames}
                        allowExclude={false} />
          </View>
        ))}
        <Button variant="secondary" onPress={() => setRows((rs) => [...rs, emptyRow()])}>
          <Plus size={16} color={t.ink} /><Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>Add step</Text>
        </Button>
      </View>

      <Button style={{ width: '100%' }} onPress={() => save.mutate()}
              disabled={!name.trim() || !docType.trim() || !steps.length || save.isPending} busy={save.isPending}>
        {editing ? 'Save changes' : 'Create chain'}
      </Button>
      <Text style={{ fontSize: 12, color: t.ink3 }}>
        Papers already routing keep their steps — only new documents get the updated chain.
      </Text>
    </Sheet>
  );
}
