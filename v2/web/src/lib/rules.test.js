import { describe, expect, it } from 'vitest';
import {
  autoMatchedChain, collectFlagNames, computeDue, describeCondition,
  describeItemRule, diagnoseChecklist, eventOk, flagOk, humanizeFlag,
  matchedTemplates, templateItems, visibleChainSteps,
} from './rules.js';

const step = (ord, condition_json = null, label = `step ${ord}`) =>
  ({ ord, label, condition_json });
const chain = (steps, name = 'Chain', doc_type = 'concept_paper') =>
  ({ name, doc_type, steps });
const template = (items, { track = 'paper', event_type = null, name = 'T' } = {}) =>
  ({ id: name, name, track, event_type, items });
const item = (ord, rule_json = null, label = `item ${ord}`) =>
  ({ ord, label, rule_json });

describe('eventOk', () => {
  it('passes with no rule', () => {
    expect(eventOk(null, 'seminar')).toBe(true);
    expect(eventOk(undefined, null)).toBe(true);
  });
  it('filters by include_if_event_type', () => {
    const r = { include_if_event_type: 'webinar' };
    expect(eventOk(r, 'webinar')).toBe(true);
    expect(eventOk(r, 'seminar')).toBe(false);
    expect(eventOk(r, null)).toBe(false);
  });
  it('filters by exclude_if_event_type', () => {
    const r = { exclude_if_event_type: 'webinar' };
    expect(eventOk(r, 'seminar')).toBe(true);
    expect(eventOk(r, 'webinar')).toBe(false);
  });
});

describe('flagOk', () => {
  it('passes with no rule or no gate', () => {
    expect(flagOk(null, {})).toBe(true);
    expect(flagOk({}, {})).toBe(true);
  });
  it('requires the flag to be truthy', () => {
    const r = { include_if_flag: 'has_merch' };
    expect(flagOk(r, { has_merch: true })).toBe(true);
    expect(flagOk(r, { has_merch: false })).toBe(false);
    expect(flagOk(r, {})).toBe(false);
  });
});

describe('computeDue', () => {
  it('computes days before the event', () => {
    expect(computeDue({ due_days_before_event: 15 }, '2026-03-01')).toBe('2026-02-14');
  });
  it('computes days after the event', () => {
    expect(computeDue({ due_days_after_event: 7 }, '2026-03-01')).toBe('2026-03-08');
  });
  it('returns null without a rule or date', () => {
    expect(computeDue(null, '2026-03-01')).toBe(null);
    expect(computeDue({ due_days_before_event: 3 }, null)).toBe(null);
    expect(computeDue({ other: 1 }, '2026-03-01')).toBe(null);
  });
});

describe('autoMatchedChain', () => {
  const a = chain([], 'Zulu');
  const b = chain([], 'Alpha');
  it('picks the alphabetically-first matching chain', () => {
    expect(autoMatchedChain([a, b], 'concept_paper').name).toBe('Alpha');
  });
  it('ignores other doc types and empty input', () => {
    expect(autoMatchedChain([a, b], 'letter')).toBe(null);
    expect(autoMatchedChain(null, 'x')).toBe(null);
  });
});

describe('visibleChainSteps', () => {
  const steps = [
    step(2, null, 'plain second'),
    step(1, { include_if_event_type: 'webinar_intl' }, 'intl only'),
    step(3, { include_if_flag: 'has_merch' }, 'merch only'),
  ];
  const c = chain(steps);

  it('sorts by ord and filters gated steps', () => {
    const out = visibleChainSteps(c, { eventType: 'seminar', flags: {} });
    expect(out.map((s) => s.label)).toEqual(['plain second']);
  });
  it('includes steps whose conditions match', () => {
    const out = visibleChainSteps(c, { eventType: 'webinar_intl', flags: { has_merch: true } });
    expect(out.map((s) => s.label)).toEqual(['intl only', 'plain second', 'merch only']);
  });
  it('defaults missing opts — no chain or null chain', () => {
    expect(visibleChainSteps(null)).toEqual([]);
    expect(visibleChainSteps(c).map((s) => s.ord)).toEqual([2]); // only the unconditional step
  });
  it('regression: positional/null opts must not throw (the /documents crash)', () => {
    expect(() => visibleChainSteps(c, null, {})).not.toThrow();
    expect(visibleChainSteps(c, null, {})).toEqual([steps[0]]); // unconditional step only
    expect(() => visibleChainSteps(c, 'webinar_intl', {})).not.toThrow();
  });
});

describe('matchedTemplates', () => {
  const paperT = template([], { track: 'paper', name: 'p' });
  const logiT = template([], { track: 'logistics', name: 'l' });
  const bothT = template([], { track: 'both', name: 'b' });
  const typedT = template([], { track: 'both', event_type: 'ces', name: 't' });
  const all = [paperT, logiT, bothT, typedT];

  it('matches track and untyped event', () => {
    const out = matchedTemplates(all, { paper: true, logistics: false, eventType: 'seminar' });
    expect(out.map((t) => t.name).sort()).toEqual(['b', 'p']);
  });
  it('matches a scoped template only on its event type', () => {
    expect(matchedTemplates(all, { paper: true, logistics: true, eventType: 'ces' }).map((t) => t.name).sort())
      .toEqual(['b', 'l', 'p', 't']);
    expect(matchedTemplates(all, { paper: false, logistics: true, eventType: 'x' }).map((t) => t.name).sort())
      .toEqual(['b', 'l']);
  });
  it('tolerates null/undefined opts', () => {
    expect(matchedTemplates(all, null)).toEqual([]);
    expect(matchedTemplates(null, { paper: true })).toEqual([]);
  });
});

describe('templateItems', () => {
  const t = template([
    item(2),
    item(1, { include_if_flag: 'off_campus' }),
    item(3, { include_if_event_type: 'webinar' }),
    item(4, { due_days_before_event: 15, include_if_flag: 'off_campus' }),
  ]);
  it('sorts, filters, and attaches computed due dates', () => {
    const out = templateItems(t, { eventType: 'webinar', flags: { off_campus: true }, targetDate: '2026-03-01' });
    expect(out.map((i) => i.ord)).toEqual([1, 2, 3, 4]);
    expect(out.find((i) => i.ord === 4).due).toBe('2026-02-14');
    expect(out.find((i) => i.ord === 2).due).toBe(null);
  });
  it('tolerates null opts and empty template', () => {
    expect(templateItems(t, null).map((i) => i.ord)).toEqual([2]);
    expect(templateItems(null)).toEqual([]);
  });
});

describe('diagnoseChecklist', () => {
  it('no_needs when neither track is ticked', () => {
    expect(diagnoseChecklist([template([])], { paper: false, logistics: false }).reason).toBe('no_needs');
  });
  it('no_templates when the org has none', () => {
    expect(diagnoseChecklist([], { paper: true }).reason).toBe('no_templates');
  });
  it('track_mismatch when no template covers the needed track', () => {
    expect(diagnoseChecklist([template([], { track: 'paper' })], { logistics: true }).reason).toBe('track_mismatch');
  });
  it('event_type_mismatch when only typed templates exist', () => {
    const ts = [template([], { track: 'paper', event_type: 'ces' })];
    expect(diagnoseChecklist(ts, { paper: true, eventType: 'seminar' }).reason).toBe('event_type_mismatch');
  });
  it('items_filtered when every item is gated out', () => {
    const ts = [template([item(1, { include_if_flag: 'x' })])];
    const d = diagnoseChecklist(ts, { paper: true, flags: {} });
    expect(d.reason).toBe('items_filtered');
    expect(d.matched).toHaveLength(1);
    expect(d.items).toHaveLength(0);
  });
  it('ok with items when anything produces', () => {
    const ts = [template([item(1)])];
    const d = diagnoseChecklist(ts, { paper: true });
    expect(d.reason).toBe('ok');
    expect(d.items[0].template_name).toBe('T');
  });
});

describe('sentence helpers', () => {
  it('describeCondition renders each gate', () => {
    expect(describeCondition(null)).toBe(null);
    expect(describeCondition({})).toBe(null);
    expect(describeCondition({ include_if_event_type: 'webinar' })).toContain('webinar');
    expect(describeCondition({ exclude_if_event_type: 'ces' })).toContain('not for ces');
    expect(describeCondition({ include_if_flag: 'has_merch' })).toContain('Has merch');
  });
  it('describeItemRule includes due rules', () => {
    expect(describeItemRule(null)).toBe(null);
    expect(describeItemRule({ due_days_before_event: 15 })).toContain('15 days before');
    expect(describeItemRule({ due_days_after_event: 7 })).toContain('7 days after');
  });
  it('humanizeFlag cleans up names', () => {
    expect(humanizeFlag('has_merch')).toBe('Has merch');
    expect(humanizeFlag(null)).toBe('');
  });
  it('collectFlagNames gathers flags from chains and templates', () => {
    const names = collectFlagNames({
      chains: [chain([step(1, { include_if_flag: 'b' })])],
      templates: [template([item(1, { include_if_flag: 'a' })])],
    });
    expect(names).toEqual(['a', 'b']);
  });
});
