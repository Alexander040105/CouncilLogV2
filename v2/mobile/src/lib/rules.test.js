/** node --test — pure engine coverage for the checklist/chain matching
 *  rules. Mirror of web/src/lib/rules.test.js — the two rules.js files are
 *  byte-identical, keep the suites aligned too. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    assert.equal(eventOk(null, 'seminar'), true);
    assert.equal(eventOk(undefined, null), true);
  });
  it('filters by include_if_event_type', () => {
    const r = { include_if_event_type: 'webinar' };
    assert.equal(eventOk(r, 'webinar'), true);
    assert.equal(eventOk(r, 'seminar'), false);
    assert.equal(eventOk(r, null), false);
  });
  it('filters by exclude_if_event_type', () => {
    const r = { exclude_if_event_type: 'webinar' };
    assert.equal(eventOk(r, 'seminar'), true);
    assert.equal(eventOk(r, 'webinar'), false);
  });
});

describe('flagOk', () => {
  it('requires the flag to be truthy', () => {
    const r = { include_if_flag: 'has_merch' };
    assert.equal(flagOk(r, { has_merch: true }), true);
    assert.equal(flagOk(r, { has_merch: false }), false);
    assert.equal(flagOk(r, {}), false);
    assert.equal(flagOk(null, {}), true);
  });
});

describe('computeDue', () => {
  it('computes days before/after the event', () => {
    assert.equal(computeDue({ due_days_before_event: 15 }, '2026-03-01'), '2026-02-14');
    assert.equal(computeDue({ due_days_after_event: 7 }, '2026-03-01'), '2026-03-08');
  });
  it('returns null without a rule or date', () => {
    assert.equal(computeDue(null, '2026-03-01'), null);
    assert.equal(computeDue({ due_days_before_event: 3 }, null), null);
    assert.equal(computeDue({ other: 1 }, '2026-03-01'), null);
  });
});

describe('autoMatchedChain', () => {
  const a = chain([], 'Zulu');
  const b = chain([], 'Alpha');
  it('picks the alphabetically-first matching chain', () => {
    assert.equal(autoMatchedChain([a, b], 'concept_paper').name, 'Alpha');
  });
  it('ignores other doc types and empty input', () => {
    assert.equal(autoMatchedChain([a, b], 'letter'), null);
    assert.equal(autoMatchedChain(null, 'x'), null);
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
    assert.deepEqual(out.map((s) => s.label), ['plain second']);
  });
  it('includes steps whose conditions match', () => {
    const out = visibleChainSteps(c, { eventType: 'webinar_intl', flags: { has_merch: true } });
    assert.deepEqual(out.map((s) => s.label), ['intl only', 'plain second', 'merch only']);
  });
  it('regression: positional/null opts must not throw (the documents crash)', () => {
    assert.doesNotThrow(() => visibleChainSteps(c, null, {}));
    assert.deepEqual(visibleChainSteps(c, null, {}), [steps[0]]); // unconditional only
    assert.doesNotThrow(() => visibleChainSteps(c, 'webinar_intl', {}));
    assert.deepEqual(visibleChainSteps(null), []);
  });
});

describe('matchedTemplates', () => {
  const all = [
    template([], { track: 'paper', name: 'p' }),
    template([], { track: 'logistics', name: 'l' }),
    template([], { track: 'both', name: 'b' }),
    template([], { track: 'both', event_type: 'ces', name: 't' }),
  ];
  it('matches track and untyped event', () => {
    assert.deepEqual(
      matchedTemplates(all, { paper: true, logistics: false, eventType: 'seminar' })
        .map((x) => x.name).sort(),
      ['b', 'p']);
  });
  it('matches a scoped template only on its event type', () => {
    assert.deepEqual(
      matchedTemplates(all, { paper: true, logistics: true, eventType: 'ces' })
        .map((x) => x.name).sort(),
      ['b', 'l', 'p', 't']);
  });
  it('tolerates null/undefined opts', () => {
    assert.deepEqual(matchedTemplates(all, null), []);
    assert.deepEqual(matchedTemplates(null, { paper: true }), []);
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
    assert.deepEqual(out.map((i) => i.ord), [1, 2, 3, 4]);
    assert.equal(out.find((i) => i.ord === 4).due, '2026-02-14');
    assert.equal(out.find((i) => i.ord === 2).due, null);
  });
  it('tolerates null opts and empty template', () => {
    assert.deepEqual(templateItems(t, null).map((i) => i.ord), [2]);
    assert.deepEqual(templateItems(null), []);
  });
});

describe('diagnoseChecklist', () => {
  it('covers every reason', () => {
    assert.equal(diagnoseChecklist([template([])], { paper: false, logistics: false }).reason, 'no_needs');
    assert.equal(diagnoseChecklist([], { paper: true }).reason, 'no_templates');
    assert.equal(
      diagnoseChecklist([template([], { track: 'paper' })], { logistics: true }).reason,
      'track_mismatch');
    assert.equal(
      diagnoseChecklist([template([], { track: 'paper', event_type: 'ces' })],
        { paper: true, eventType: 'seminar' }).reason,
      'event_type_mismatch');
    assert.equal(
      diagnoseChecklist([template([item(1, { include_if_flag: 'x' })])],
        { paper: true, flags: {} }).reason,
      'items_filtered');
    const ok = diagnoseChecklist([template([item(1)])], { paper: true });
    assert.equal(ok.reason, 'ok');
    assert.equal(ok.items[0].template_name, 'T');
  });
});

describe('sentence helpers', () => {
  it('describeCondition renders each gate', () => {
    assert.equal(describeCondition(null), null);
    assert.match(describeCondition({ include_if_event_type: 'webinar' }), /webinar/);
    assert.match(describeCondition({ exclude_if_event_type: 'ces' }), /not for ces/);
    assert.match(describeCondition({ include_if_flag: 'has_merch' }), /Has merch/);
  });
  it('describeItemRule includes due rules', () => {
    assert.equal(describeItemRule(null), null);
    assert.match(describeItemRule({ due_days_before_event: 15 }), /15 days before/);
    assert.match(describeItemRule({ due_days_after_event: 7 }), /7 days after/);
  });
  it('humanizeFlag and collectFlagNames', () => {
    assert.equal(humanizeFlag('has_merch'), 'Has merch');
    assert.equal(humanizeFlag(null), '');
    const names = collectFlagNames({
      chains: [chain([step(1, { include_if_flag: 'b' })])],
      templates: [template([item(1, { include_if_flag: 'a' })])],
    });
    assert.deepEqual(names, ['a', 'b']);
  });
});
