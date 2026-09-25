/** Client-side mirror of api/app/services/instantiate.py — used only for
 *  creation-time previews (documents + projects). The server still authors
 *  the real snapshot; keep these rules in sync with it. */

export function eventOk(rule, eventType) {
  if (!rule) return true;
  if (rule.include_if_event_type != null && rule.include_if_event_type !== eventType) return false;
  if (rule.exclude_if_event_type != null && rule.exclude_if_event_type === eventType) return false;
  return true;
}

export function flagOk(rule, flags = {}) {
  if (!rule) return true;
  if (rule.include_if_flag != null && !flags[rule.include_if_flag]) return false;
  return true;
}

/** `YYYY-MM-DD` shifted by rule due_days_before/after_event; null otherwise. */
export function computeDue(rule, targetDate) {
  if (!rule || !targetDate) return null;
  const n = rule.due_days_before_event ?? rule.due_days_after_event;
  if (n == null) return null;
  const d = new Date(`${targetDate}T00:00:00`);
  d.setDate(d.getDate() + (rule.due_days_before_event != null ? -n : n));
  return d.toISOString().slice(0, 10);
}

/** The chain a new document with this doc_type will auto-match (name-asc first). */
export function autoMatchedChain(chains, docType) {
  return (chains ?? [])
    .filter((c) => c.doc_type === docType)
    .sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
}

/** Steps that will actually instantiate — chain steps carry condition_json. */
export function visibleChainSteps(chain, { eventType = null, flags = {} } = {}) {
  return [...(chain?.steps ?? [])]
    .sort((a, b) => a.ord - b.ord)
    .filter((s) => eventOk(s.condition_json, eventType) && flagOk(s.condition_json, flags));
}

/** Templates the project will instantiate from — server rule:
 *  track matches paper/logistics needs AND (no event_type OR == project's). */
export function matchedTemplates(templates, { paper, logistics, eventType }) {
  const wanted = [...(paper ? ['paper', 'both'] : []), ...(logistics ? ['logistics', 'both'] : [])];
  return (templates ?? [])
    .filter((t) => wanted.includes(t.track)
      && (t.event_type == null || t.event_type === eventType));
}

/** Items a template will produce for a given event_type/target_date. */
export function templateItems(template, { eventType = null, targetDate = null } = {}) {
  return [...(template?.items ?? [])]
    .sort((a, b) => a.ord - b.ord)
    .filter((i) => eventOk(i.rule_json, eventType) && flagOk(i.rule_json, {}))
    .map((i) => ({ ...i, due: computeDue(i.rule_json, targetDate) }));
}

/** Why auto-match will/won't produce items — mirrors diagnose_checklist in
 *  api/app/services/instantiate.py (same enum, same precedence; keep in sync). */
export function diagnoseChecklist(templates, { paper, logistics, eventType = null, targetDate = null } = {}) {
  const all = templates ?? [];
  const matched = matchedTemplates(all, { paper, logistics, eventType });
  const items = matched.flatMap((t) =>
    templateItems(t, { eventType, targetDate }).map((i) => ({ ...i, templateId: t.id })));
  let reason;
  if (!paper && !logistics) reason = 'no_needs';
  else if (!all.length) reason = 'no_templates';
  else {
    const wanted = [...(paper ? ['paper', 'both'] : []), ...(logistics ? ['logistics', 'both'] : [])];
    if (!all.some((t) => wanted.includes(t.track))) reason = 'track_mismatch';
    else if (!matched.length) reason = 'event_type_mismatch';
    else if (!items.length) reason = 'items_filtered';
    else reason = 'ok';
  }
  return { reason, matched, items };
}
