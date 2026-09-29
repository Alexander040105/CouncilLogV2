import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { patch, post } from '../lib/api';
import { currentOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
import { Button, Field, Input, Sheet } from './ui';
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
  { value: 'paper', label: 'paper', sub: 'signatory-routed documents' },
  { value: 'logistics', label: 'logistics', sub: 'venue, food, equipment' },
  { value: 'both', label: 'both', sub: 'either kind of project' },
];

/** Full checklist-template editor — name/track/scope + ordered item rows
 *  with hints, optional flags, when-conditions, and due rules. */
export function TemplateEditor({ open, onClose, template, eventTypes = [], flagNames = [] }) {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const editing = !!template?.id;
  const [name, setName] = useState('');
  const [track, setTrack] = useState('paper');
  const [evt, setEvt] = useState('');
  const [rows, setRows] = useState([emptyRow()]);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setTrack(template?.track ?? 'paper');
    setEvt(template?.event_type ?? '');
    setRows(template?.items?.length ? template.items.map(rowFromItem) : [emptyRow()]);
  }, [open, template]);

  const setRow = (i, patchRow) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patchRow } : r)));
  const removeRow = (i) => setRows((rs) => rs.filter((_, k) => k !== i));
  const move = (i, dir) => setRows((rs) => {
    const j = i + dir;
    if (j < 0 || j >= rs.length) return rs;
    const next = [...rs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

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
      <div className="space-y-3">
        <Field label="Template name" hint="What people see when picking checklists — e.g. Concept Paper Pack.">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Track" hint="paper = signatory-routed docs · logistics = venue/equipment · both = applies to either">
          <select className="min-h-[44px] w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
                  value={track} onChange={(e) => setTrack(e.target.value)}>
            {TRACKS.map((t) => <option key={t.value} value={t.value}>{t.label} — {t.sub}</option>)}
          </select>
        </Field>
        <Field label="Event type (optional)" hint="Leave blank to match every event type — or scope this to one, e.g. webinar_intl.">
          <Input list="tpl-event-types" value={evt} onChange={(e) => setEvt(e.target.value)} placeholder="any" />
          <datalist id="tpl-event-types">
            {eventTypes.map((t) => <option key={t} value={t} />)}
          </datalist>
        </Field>

        <div className="space-y-2">
          <div className="text-sm font-medium">Items, in order</div>
          <p className="text-xs text-[var(--color-ink-3)]">
            Each becomes a checklist item on matching projects. Hints say where to go or what to watch for; optional items are reminders that don't block.
          </p>
          {rows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-[var(--radius-card)] [border:var(--border-box)] p-2">
              <div className="flex items-start gap-1">
                <Input className="min-w-0 flex-1" placeholder={`Item ${i + 1}`} aria-label={`Item ${i + 1}`}
                       value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
                <Button variant="ghost" className="min-h-[44px] px-2" aria-label="Move item up"
                        disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></Button>
                <Button variant="ghost" className="min-h-[44px] px-2" aria-label="Move item down"
                        disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></Button>
                <Button variant="ghost" className="min-h-[44px] px-2" aria-label="Remove item"
                        onClick={() => removeRow(i)}><X size={16} /></Button>
              </div>
              <Input placeholder="Hint (optional) — where to go, what to watch for" aria-label={`Hint for item ${i + 1}`}
                     value={r.hint} onChange={(e) => setRow(i, { hint: e.target.value })} />
              <WhenSelect mode={r.mode} condValue={r.condValue}
                          onMode={(m) => setRow(i, { mode: m, condValue: m === 'always' ? '' : r.condValue })}
                          onCondValue={(v) => setRow(i, { condValue: v })}
                          eventTypes={eventTypes} flagNames={flagNames} datalistId={`when-${i}`} />
              <DueSelect dueMode={r.dueMode} dueN={r.dueN}
                         onMode={(m) => setRow(i, { dueMode: m })} onN={(v) => setRow(i, { dueN: v })} />
              <label className="flex min-h-[44px] items-center gap-2 text-sm text-[var(--color-ink-2)]">
                <input type="checkbox" className="h-4 w-4"
                       checked={r.required === false} onChange={(e) => setRow(i, { required: !e.target.checked })} />
                optional — a reminder, not a blocker
              </label>
            </div>
          ))}
          <Button variant="secondary" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Plus size={16} />Add item</Button>
        </div>

        <Button className="w-full" onClick={() => save.mutate()}
                disabled={!name.trim() || !items.length || save.isPending}>
          {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create template'}
        </Button>
        <p className="text-xs text-[var(--color-ink-3)]">
          Only future checklists use the new version — projects already generated keep their copies.
        </p>
      </div>
    </Sheet>
  );
}
