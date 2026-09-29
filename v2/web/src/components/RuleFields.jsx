import { Field } from './ui';
import { humanizeFlag } from '../lib/rules';

/** Shared controls for editing rule_json / condition_json without ever
 *  showing JSON. A row's "when" is (mode, condValue) and serializes to one
 *  include/exclude key; items may also carry a due rule (dueMode, dueN). */

export const WHEN_ALWAYS = 'always';

export function whenFromJson(rule) {
  if (rule?.include_if_event_type != null) return { mode: 'event', condValue: rule.include_if_event_type };
  if (rule?.exclude_if_event_type != null) return { mode: 'not_event', condValue: rule.exclude_if_event_type };
  if (rule?.include_if_flag != null) return { mode: 'flag', condValue: rule.include_if_flag };
  return { mode: WHEN_ALWAYS, condValue: '' };
}

export function dueFromJson(rule) {
  if (rule?.due_days_before_event != null) return { dueMode: 'before', dueN: rule.due_days_before_event };
  if (rule?.due_days_after_event != null) return { dueMode: 'after', dueN: rule.due_days_after_event };
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

const SEL =
  'min-h-[44px] rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-2 text-sm';

/** "When does this apply" — always / only event type / not event type /
 *  only when flag. allowExclude=false drops the not-for option (chains). */
export function WhenSelect({ mode, condValue, onMode, onCondValue, eventTypes = [], flagNames = [], allowExclude = true, datalistId }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="When does this apply" className={SEL} value={mode} onChange={(e) => onMode(e.target.value)}>
        <option value={WHEN_ALWAYS}>always</option>
        <option value="event">only for event type…</option>
        {allowExclude && <option value="not_event">not for event type…</option>}
        <option value="flag">only when flag…</option>
      </select>
      {mode !== WHEN_ALWAYS && (
        <>
          <input
            className="min-h-[44px] min-w-0 flex-1 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
            list={datalistId}
            value={condValue}
            onChange={(e) => onCondValue(e.target.value)}
            placeholder={mode === 'flag' ? 'e.g. off_campus' : 'e.g. webinar_intl'}
          />
          <datalist id={datalistId}>
            {(mode === 'flag' ? flagNames : eventTypes).map((v) => <option key={v} value={v} />)}
          </datalist>
        </>
      )}
    </div>
  );
}

/** Optional due-date rule for checklist items. */
export function DueSelect({ dueMode, dueN, onMode, onN }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Due date rule" className={SEL} value={dueMode} onChange={(e) => onMode(e.target.value)}>
        <option value="">no due date</option>
        <option value="before">due N days before the event</option>
        <option value="after">due N days after the event</option>
      </select>
      {dueMode && (
        <input
          type="number" min="1" inputMode="numeric"
          aria-label="Number of days"
          className="min-h-[44px] w-20 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
          value={dueN}
          onChange={(e) => onN(e.target.value)}
          placeholder="15"
        />
      )}
    </div>
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
      <div className="flex flex-wrap gap-2">
        {flagNames.map((f) => (
          <label key={f}
                 className="flex min-h-[44px] items-center gap-2 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm">
            <input type="checkbox" className="h-4 w-4"
                   checked={!!value[f]} onChange={(e) => toggle(f, e.target.checked)} />
            {humanizeFlag(f)}
          </label>
        ))}
      </div>
    </Field>
  );
}
