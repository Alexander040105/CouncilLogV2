/** One place for enum → human text, so casing never drifts between pages.
 *  Rule: user-facing copy is sentence case — "Unassigned", "Concept paper",
 *  "In revision" — never raw enum values like `concept_paper` or `unassigned`. */

/** `concept_paper` → `Concept paper`; `awaiting_signature` → `Awaiting signature`. */
export function humanize(s) {
  return String(s ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/** Proper-noun exceptions that should stay capitalized inside a phrase. */
const ACRONYMS = new Set(['ssc', 'ccsc', 'osa', 'sdo']);

/** `concept_paper` → `Concept Paper` when shown as a name/badge. */
export function docTypeLabel(s) {
  return String(s ?? '')
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.replace(/^./, (c) => c.toUpperCase())))
    .join(' ');
}

export const PROJECT_STATUS = {
  draft: 'Draft',
  active: 'Active',
  done: 'Done',
  archived: 'Archived',
};

export const TASK_STATUS = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const DOC_STATUS = {
  drafting: 'Drafting',
  in_progress: 'In progress',
  revision: 'In revision',
  signed: 'Signed',
  filed: 'Filed',
};

export const projectStatusLabel = (s) => PROJECT_STATUS[s] ?? humanize(s);
export const taskStatusLabel = (s) => TASK_STATUS[s] ?? humanize(s);
export const docStatusLabel = (s) => DOC_STATUS[s] ?? humanize(s);

/** Assignee display: null → "Unassigned", self → "You", else the name. */
export function assigneeLabel(id, myId, nameOf) {
  if (!id) return 'Unassigned';
  if (id === myId) return 'You';
  return nameOf?.(id) ?? 'Someone';
}
