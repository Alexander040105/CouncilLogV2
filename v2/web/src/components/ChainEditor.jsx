import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { patch, post } from '../lib/api';
import { currentOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
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

/** Full signatory-chain editor — name/doc_type + ordered step rows with
 *  office locations and optional conditions (event type or flag). */
export function ChainEditor({ open, onClose, chain, docTypes = [], eventTypes = [], flagNames = [] }) {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
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
      <div className="space-y-3">
        <Field label="Chain name" hint="e.g. Standard concept paper route — shown when a paper picks this chain.">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Doc type" hint="Must match a document's type exactly — that's how papers pick this chain automatically.">
          <Input list="chain-doc-types" value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="concept_paper" />
          <datalist id="chain-doc-types">
            {docTypes.map((t) => <option key={t} value={t} />)}
          </datalist>
        </Field>

        <div className="space-y-2">
          <div className="text-sm font-medium">Steps, in signing order</div>
          <p className="text-xs text-[var(--color-ink-3)]">
            Each line is one desk the paper visits, top to bottom. Office = where the desk physically is. A condition means the step only applies some of the time.
          </p>
          {rows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-[var(--radius-card)] [border:var(--border-box)] p-2">
              <div className="flex items-start gap-1">
                <Input className="min-w-0 flex-1" placeholder={`Step ${i + 1} — who signs`} aria-label={`Step ${i + 1}`}
                       value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
                <Button variant="ghost" className="min-h-[44px] px-2" aria-label="Move step up"
                        disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></Button>
                <Button variant="ghost" className="min-h-[44px] px-2" aria-label="Move step down"
                        disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></Button>
                <Button variant="ghost" className="min-h-[44px] px-2" aria-label="Remove step"
                        onClick={() => removeRow(i)}><X size={16} /></Button>
              </div>
              <Input placeholder="Office (optional) — e.g. 2nd floor hallway, left side" aria-label={`Office for step ${i + 1}`}
                     value={r.office} onChange={(e) => setRow(i, { office: e.target.value })} />
              <WhenSelect mode={r.mode} condValue={r.condValue}
                          onMode={(m) => setRow(i, { mode: m, condValue: m === 'always' ? '' : r.condValue })}
                          onCondValue={(v) => setRow(i, { condValue: v })}
                          eventTypes={eventTypes} flagNames={flagNames}
                          allowExclude={false} datalistId={`chain-when-${i}`} />
            </div>
          ))}
          <Button variant="secondary" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Plus size={16} />Add step</Button>
        </div>

        <Button className="w-full" onClick={() => save.mutate()}
                disabled={!name.trim() || !docType.trim() || !steps.length || save.isPending}>
          {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create chain'}
        </Button>
        <p className="text-xs text-[var(--color-ink-3)]">
          Papers already routing keep their steps — only new documents get the updated chain.
        </p>
      </div>
    </Sheet>
  );
}
