import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { describeReason, matchedTemplates, templateItems } from '../lib/rules';
import { humanize } from '../lib/labels';
import { Button, Input, Skeleton } from './ui';

/** Editable checklist snapshot for a project being created (or reshaped).
 *
 *  Templates are suggestions, not gates: the needs-papers / needs-logistics
 *  toggles pre-check the matching templates, but every template stays
 *  checkable and every resulting item row is editable before it lands.
 *  `items`/`onItems` are controlled so the parent owns the snapshot it POSTs.
 *
 *  Item shape: { key, label, hint, required, due_date, from } where
 *  `from` is the source template name (or null for hand-added rows). */
export function ChecklistEditor({ templates, paper, logistics, eventType,
                                  flags = {}, targetDate, items, onItems }) {
  const ctx = { eventType: eventType || null, flags, targetDate: targetDate || null };

  // which template checkboxes are on; autoRef remembers what the toggles
  // picked so manual extras survive a later toggle change
  const [selected, setSelected] = useState(() => new Set());
  const autoRef = useRef(new Set());
  const removedRef = useRef(new Set());
  const customN = useRef(0);

  // toggles re-suggest; manually added selections persist
  useEffect(() => {
    if (!templates) return;
    const matched = matchedTemplates(templates, { paper, logistics, eventType: ctx.eventType });
    const auto = new Set(matched.map((t) => t.id));
    setSelected((prev) => {
      const manual = [...prev].filter((id) => !autoRef.current.has(id));
      return new Set([...auto, ...manual]);
    });
    autoRef.current = auto;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, logistics, eventType, templates]);

  // regenerate the base list when selection/context changes — edits to
  // still-present items are kept, user-deleted rows stay deleted
  const base = useMemo(() => {
    if (!templates) return [];
    return templates
      .filter((t) => selected.has(t.id))
      .flatMap((t) => templateItems(t, ctx).map((i) => ({
        key: `${t.id}:${i.id}`, label: i.label, hint: i.hint ?? null,
        required: i.required ?? true, due_date: i.due ?? null, from: t.name,
      })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, selected, eventType, JSON.stringify(flags), targetDate]);

  useEffect(() => {
    const fresh = new Map(base.map((i) => [i.key, i]));
    const kept = items.filter((i) => i.custom || (fresh.has(i.key) && !removedRef.current.has(i.key)));
    const keptKeys = new Set(kept.map((i) => i.key));
    const appended = base.filter((i) => !keptKeys.has(i.key) && !removedRef.current.has(i.key));
    const next = [...kept, ...appended];
    if (JSON.stringify(next) !== JSON.stringify(items)) onItems(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  if (!templates) return <Skeleton className="h-32" />;

  const setItem = (key, patch) =>
    onItems(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const removeItem = (key) => {
    removedRef.current.add(key);
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
    removedRef.current = new Set();
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

  return (
    <div className="space-y-3">
      <div>
        <div className="label-strong text-sm text-[var(--color-ink-2)]">Checklist templates</div>
        <p className="text-xs text-[var(--color-ink-3)]">
          Ticked automatically from your paper/logistics picks — adjust freely,
          then edit the items below.
        </p>
        {templates.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">
            {describeReason('no_templates')}
          </p>
        ) : (
          <div className="mt-1.5 space-y-1">
            {templates.map((t) => (
              <label key={t.id} className="flex min-h-[36px] items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4"
                       checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                <span className="flex-1">{t.name}</span>
                <span className="text-xs text-[var(--color-ink-3)]">
                  {trackChip[t.track] ?? humanize(t.track)}
                  {t.event_type ? ` · ${humanize(t.event_type)}` : ''}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div className="label-strong text-sm text-[var(--color-ink-2)]">
            Checklist on save — {items.length} item{items.length === 1 ? '' : 's'}
          </div>
          {removedRef.current.size > 0 && (
            <button type="button" className="text-xs text-[var(--color-accent)]"
                    onClick={reset}>
              <RotateCcw size={11} className="mr-0.5 inline" /> Restore removed
            </button>
          )}
        </div>
        {items.length === 0 && (
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">
            Nothing on the checklist — add a row below, or the project can still
            generate one later from its detail page.
          </p>
        )}
        <div className="mt-1 space-y-2">
          {items.map((it, idx) => (
            <div key={it.key} className="rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] p-2">
              <div className="flex items-center gap-1.5">
                <Input
                  value={it.label} placeholder="What needs doing?"
                  aria-label={`Item ${idx + 1} label`} className="min-h-[38px] flex-1"
                  onChange={(e) => setItem(it.key, { label: e.target.value })}
                />
                <button type="button" aria-label="Move item up" disabled={idx === 0}
                        className="min-h-[36px] min-w-[36px] text-[var(--color-ink-3)] disabled:opacity-30"
                        onClick={() => move(idx, -1)}><ArrowUp size={15} className="mx-auto" /></button>
                <button type="button" aria-label="Move item down" disabled={idx === items.length - 1}
                        className="min-h-[36px] min-w-[36px] text-[var(--color-ink-3)] disabled:opacity-30"
                        onClick={() => move(idx, 1)}><ArrowDown size={15} className="mx-auto" /></button>
                <button type="button" aria-label={`Remove ${it.label || 'item'}`}
                        className="min-h-[36px] min-w-[36px] text-[var(--color-status-alert)]"
                        onClick={() => removeItem(it.key)}><Trash2 size={15} className="mx-auto" /></button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Input
                  value={it.hint ?? ''} placeholder="Hint (optional)"
                  aria-label={`Item ${idx + 1} hint`} className="min-h-[34px] flex-1 basis-40 text-xs"
                  onChange={(e) => setItem(it.key, { hint: e.target.value || null })}
                />
                <input type="date" value={it.due_date ?? ''} aria-label={`Item ${idx + 1} due date`}
                       className="min-h-[34px] rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-2 text-xs"
                       onChange={(e) => setItem(it.key, { due_date: e.target.value || null })} />
                <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
                  <input type="checkbox" className="h-3.5 w-3.5" checked={it.required}
                         onChange={(e) => setItem(it.key, { required: e.target.checked })} />
                  Required
                </label>
                {it.from && <span className="text-[11px] text-[var(--color-ink-3)]">from {it.from}</span>}
              </div>
            </div>
          ))}
        </div>
        <Button variant="secondary" className="mt-2 min-h-[38px] w-full text-xs" onClick={addCustom}>
          <Plus size={14} /> Add item
        </Button>
      </div>
    </div>
  );
}
