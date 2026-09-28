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
  const d = new Date(`${targetDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (rule.due_days_before_event != null ? -n : n));
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

/** Items a template will produce for a given event_type/flags/target_date. */
export function templateItems(template, { eventType = null, flags = {}, targetDate = null } = {}) {
  return [...(template?.items ?? [])]
    .sort((a, b) => a.ord - b.ord)
    .filter((i) => eventOk(i.rule_json, eventType) && flagOk(i.rule_json, flags))
    .map((i) => ({ ...i, due: computeDue(i.rule_json, targetDate) }));
}

/** Why auto-match will/won't produce items — mirrors diagnose_checklist in
 *  api/app/services/instantiate.py (same enum, same precedence; keep in sync). */
export function diagnoseChecklist(templates, { paper, logistics, eventType = null, flags = {}, targetDate = null } = {}) {
  const all = templates ?? [];
  const matched = matchedTemplates(all, { paper, logistics, eventType });
  const items = matched.flatMap((t) =>
    templateItems(t, { eventType, flags, targetDate })
      .map((i) => ({ ...i, templateId: t.id, template_name: t.name })));
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

/** Why a checklist preview/generate produced zero items — in words. */
export function describeReason(reason) {
  switch (reason) {
    case 'no_needs':
      return 'No tracks ticked — the project isn\'t asking for papers or logistics, so no checklist will be generated.';
    case 'no_templates':
      return 'This org has no checklist templates yet — add one in Settings, or load a starter from the Guide.';
    case 'track_mismatch':
      return 'Templates exist, but none cover the tracks this project needs.';
    case 'event_type_mismatch':
      return 'Templates exist for the right track, but none match this event type (untyped templates match anything).';
    case 'items_filtered':
      return 'Templates matched, but every item inside was filtered out by its rules (event type / flags).';
    case 'templates_not_found':
      return 'The chosen template is gone — pick another.';
    default:
      return null;
  }
}

// ── Rules & flags rendered as sentences ─────────────────────────────────

/** `has_merch` → "Has merch" — checkbox / description label for a flag name. */
export function humanizeFlag(flag) {
  return String(flag ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/** Every include_if_flag name referenced by these chains + templates. */
export function collectFlagNames({ chains = [], templates = [] } = {}) {
  const names = new Set();
  for (const c of chains)
    for (const s of c.steps ?? [])
      if (s.condition_json?.include_if_flag) names.add(s.condition_json.include_if_flag);
  for (const t of templates)
    for (const i of t.items ?? [])
      if (i.rule_json?.include_if_flag) names.add(i.rule_json.include_if_flag);
  return [...names].sort();
}

/** One chain step's condition in words; null when unconditional. */
export function describeCondition(conditionJson) {
  const c = conditionJson;
  if (!c) return null;
  const parts = [];
  if (c.include_if_event_type != null) parts.push(`only when the event type is ${c.include_if_event_type}`);
  if (c.exclude_if_event_type != null) parts.push(`not for ${c.exclude_if_event_type} events`);
  if (c.include_if_flag != null) parts.push(`only when "${humanizeFlag(c.include_if_flag)}" is ticked`);
  return parts.join(' · ') || null;
}

/** One template item's rules in words — condition + due date combined. */
export function describeItemRule(ruleJson) {
  const r = ruleJson;
  if (!r) return null;
  const parts = [];
  if (r.include_if_event_type != null) parts.push(`only for ${r.include_if_event_type} events`);
  if (r.exclude_if_event_type != null) parts.push(`not for ${r.exclude_if_event_type} events`);
  if (r.include_if_flag != null) parts.push(`only when "${humanizeFlag(r.include_if_flag)}" is ticked`);
  if (r.due_days_before_event != null) parts.push(`due ${r.due_days_before_event} days before the event`);
  if (r.due_days_after_event != null) parts.push(`due ${r.due_days_after_event} days after the event`);
  return parts.join(' · ') || null;
}
