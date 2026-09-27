import { Link, useOutletContext } from 'react-router-dom';
import { AlertTriangle, ListChecks } from 'lucide-react';
import { atLeast } from '../lib/org';
import { diagnoseChecklist } from '../lib/rules';

/** Live preview/diagnosis of the checklist a project will generate —
 *  used in the create sheet and the project-detail empty state. */
export function ChecklistPreview({ templates, paper, logistics, eventType, targetDate }) {
  const { active } = useOutletContext() ?? {};
  const isOwner = active ? atLeast(active.role, 'owner') : false;
  const diag = diagnoseChecklist(templates, { paper, logistics, eventType, targetDate });

  const fix = isOwner
    ? <Link to="/settings" className="text-[var(--color-accent)] underline">Fix in Settings → templates</Link>
    : 'Ask an owner to fix this in Settings → templates.';
  const reasonText = {
    no_needs: "This project isn't flagged for papers or logistics — nothing can generate.",
    no_templates: <>No checklist templates exist yet. {fix}</>,
    track_mismatch: <>Templates exist, but none cover this project's needs ({paper ? 'paper processing' : ''}{paper && logistics ? ' + ' : ''}{logistics ? 'logistics' : ''}). {fix}</>,
    event_type_mismatch: <>Templates exist for this track, but they're scoped to other event types — not <span className="font-mono">{eventType || 'blank'}</span>. {fix}</>,
    items_filtered: "Templates match, but every item is ruled out by its conditions.",
  };

  if (diag.reason !== 'ok') {
    return (
      <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--color-status-alert)] p-3 text-sm text-[var(--color-ink-2)]">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--color-status-alert)]" />
        <span>{reasonText[diag.reason]}</span>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-3)] p-3 text-sm">
      <div className="flex items-center gap-1.5 font-medium text-[var(--color-ink-2)]">
        <ListChecks size={15} /> Checklist will generate {diag.items.length} item{diag.items.length === 1 ? '' : 's'} from:
      </div>
      <div className="mt-1.5 space-y-2">
        {diag.matched.map((t) => {
          const items = diag.items.filter((i) => i.templateId === t.id);
          return (
            <div key={t.id}>
              <div className="text-xs font-medium text-[var(--color-ink-2)]">
                {t.name} <span className="text-[var(--color-ink-3)]">· {items.length} item{items.length === 1 ? '' : 's'}</span>
              </div>
              <ul className="ml-4 list-disc text-xs text-[var(--color-ink-3)]">
                {items.map((i) => (
                  <li key={`${t.id}-${i.ord}`}>{i.label}{i.due ? ` · due ${i.due}` : ''}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
