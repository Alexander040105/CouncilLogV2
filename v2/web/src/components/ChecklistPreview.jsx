import { Link } from 'react-router-dom';
import { describeReason, diagnoseChecklist } from '../lib/rules';

/** Live preview of the checklist a new project would get — shown in the
 *  create sheet so the owner sees which templates + rules fire before
 *  saving. Mirrors the server's instantiate logic (rules.js). */
export function ChecklistPreview({ templates, paper, logistics, eventType, flags = {}, targetDate }) {
  if (!templates) return null;
  const { reason, items } = diagnoseChecklist(templates, {
    paper, logistics, eventType, flags, targetDate,
  });
  const n = items.length;
  return (
    <div className="rounded-[var(--radius-card)] [border:var(--border-box)] bg-[var(--color-surface-2)] p-3 text-sm">
      <div className="font-medium">
        {n === 0 ? 'No checklist items' : `${n} checklist item${n === 1 ? '' : 's'}`} on save
      </div>
      {n === 0 ? (
        <div className="mt-1 text-xs text-[var(--color-ink-3)]">
          {describeReason(reason) ?? 'No templates match this project.'}{' '}
          <Link to="/guide" className="text-[var(--color-accent)] underline">How matching works</Link>
        </div>
      ) : (
        <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs text-[var(--color-ink-2)]">
          {items.map((i, k) => (
            <li key={k}>
              {i.label}
              <span className="text-[var(--color-ink-3)]"> — {i.template_name}</span>
              {i.due && <span className="text-[var(--color-ink-3)]"> · due {i.due}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
