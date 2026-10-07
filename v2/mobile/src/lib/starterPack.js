/** Starter library — example chains, templates, and contacts that show the
 *  features working end to end. Browsable by every member on /guide; an
 *  owner can install entries as completely ordinary org rows — nothing
 *  loaded is locked or special, edit and delete them like hand-typed ones.
 *
 *  Names are deliberately generic (offices, roles, bodies) — adapt them to
 *  your org when you install. Every entry carries `why` — one sentence on
 *  the design idea it demonstrates, because the library's primary job is
 *  teaching people what a well-built chain/template looks like before they
 *  write their own. */

export const STARTER_CHAINS = [
  {
    name: 'Standard Concept Paper',
    doc_type: 'concept_paper',
    why: 'The plain route is three desks; the extra steps are conditions, not separate chains, because the route is identical except for those offices.',
    steps: [
      { ord: 1, label: 'Org President', office: 'your council/org president' },
      { ord: 2, label: 'Student Affairs routing', office: 'the student affairs office — they forward the paper onward' },
      { ord: 3, label: 'External review signatory', office: 'international webinars only; confirm the current routing with your adviser',
        condition_json: { include_if_event_type: 'webinar_intl' } },
      { ord: 4, label: 'Merch/fundraising office', office: 'only for activities that sell merch',
        condition_json: { include_if_flag: 'has_merch' } },
      { ord: 5, label: 'School head', office: 'final signature — confirm the office with your officers' },
    ],
  },
  {
    name: 'Board Resolution',
    doc_type: 'board_resolution',
    why: "A whole doc type whose route is 'the concept paper chain minus one desk' gets its own chain — chains are matched by doc type, so copy the steps and drop the one that doesn't apply.",
    steps: [
      { ord: 1, label: 'Student Affairs routing', office: 'the student affairs office — they forward the paper onward' },
      { ord: 2, label: 'External review signatory', office: 'international webinars only; confirm the current routing with your adviser',
        condition_json: { include_if_event_type: 'webinar_intl' } },
      { ord: 3, label: 'Merch/fundraising office', office: 'only for activities that sell merch',
        condition_json: { include_if_flag: 'has_merch' } },
      { ord: 4, label: 'School head', office: 'final signature — confirm the office with your officers' },
    ],
  },
  {
    name: 'Extension Concept Paper',
    doc_type: 'ces_concept_paper',
    why: "A different doc type means extension papers get their own route automatically — and the coordinator's office line doubles as a reminder to bring last event's reports.",
    steps: [
      { ord: 1, label: 'Org President', office: 'your council/org president' },
      { ord: 2, label: 'Student Affairs routing', office: 'the student affairs office' },
      { ord: 3, label: 'Extension coordinator', office: "bring the previous extension activity's reports" },
      { ord: 4, label: 'School head', office: 'final signature — confirm the office with your officers' },
    ],
  },
  {
    name: 'Financial Report',
    doc_type: 'financial_report',
    why: 'Even a one-office route is worth a chain — the office note carries the deadline nobody remembers.',
    steps: [
      { ord: 1, label: 'Audit office', office: 'submit within 1 week after the event; confirm at submission whether a signature is needed' },
    ],
  },
];

export const STARTER_TEMPLATES = [
  {
    name: 'Concept Paper Pack',
    track: 'paper',
    event_type: null,
    why: 'A hint on every item so the checklist teaches as it goes; speaker items and the supplier letter are marked optional instead of deleted because they only apply sometimes.',
    items: [
      { ord: 1, label: 'Confirm the event date', hint: 'not within 1 week before or during exam week — you only get ~2-week windows' },
      { ord: 2, label: 'Summary letter' },
      { ord: 3, label: 'Board resolution', hint: 'same signatories as the concept paper minus the org president; always submitted together, never alone' },
      { ord: 4, label: 'Concept paper', hint: "fill the first page every time; keep templates + samples on your org's shared Drive; budget comes from the bank book" },
      { ord: 5, label: "Speaker's CV", required: false, hint: 'events with a guest speaker' },
      { ord: 6, label: "Speaker's certificates", required: false, hint: 'events with a guest speaker' },
      { ord: 7, label: 'Justification letter — outside supplier', required: false, hint: 'only when buying from an outside supplier instead of the usual source' },
    ],
  },
  {
    name: 'Event Logistics',
    track: 'logistics',
    event_type: null,
    why: 'The venue item shows a due-date rule in action, and the two call-link items show per-item event-type gates — the same line twice, once per event type.',
    items: [
      { ord: 1, label: 'Committees formed' },
      { ord: 2, label: 'Tarpaulin' },
      { ord: 3, label: 'Food', hint: 'committees/faculty/speaker; participants for competitions' },
      { ord: 4, label: 'Venue booked', hint: 'book in person at the facilities office after papers are done — target ~1 month out; pencil bookings can lapse in days',
        rule_json: { due_days_before_event: 30 } },
      { ord: 5, label: 'Sound system + mic', hint: 'borrowed from your IT/media office' },
      { ord: 6, label: 'Transport', hint: 'van request via the facilities office; bus via an accredited transport provider for big trips' },
      { ord: 7, label: 'Registration forms' },
      { ord: 8, label: 'Certificates', hint: 'participants + guest speaker' },
      { ord: 9, label: 'Pubmats', hint: 'poster for Facebook + invitation for the faculty' },
      { ord: 10, label: 'Video-call link', hint: 'request the form from your IT office',
        rule_json: { include_if_event_type: 'webinar' } },
      { ord: 11, label: 'Video-call link', hint: 'request the form from your IT office',
        rule_json: { include_if_event_type: 'webinar_intl' } },
    ],
  },
  {
    name: 'Outside Event Pack',
    track: 'both',
    event_type: null,
    why: 'One flag (off_campus) covers outside events AND educational tours without listing every event type — tick one checkbox on the project and the whole pack appears.',
    items: [
      { ord: 1, label: 'Regulator letter (e.g. CHED CMO No. 63 s. 2017 format)', hint: "hard copy AND emailed — get the receiving address from your registrar's office; 15 days is the floor, target a month",
        rule_json: { include_if_flag: 'off_campus', due_days_before_event: 15 } },
      { ord: 2, label: "Participant list + parents' consent",
        rule_json: { include_if_flag: 'off_campus' } },
      { ord: 3, label: 'Curriculum forms — one per course, relevant subjects highlighted',
        rule_json: { include_if_flag: 'off_campus' } },
      { ord: 4, label: 'Medical checkup letter — signed by your school clinic/physician',
        rule_json: { include_if_flag: 'off_campus' } },
      { ord: 5, label: 'Van request — form from the facilities office',
        rule_json: { include_if_flag: 'off_campus' } },
    ],
  },
  {
    name: 'Financial Report',
    track: 'paper',
    event_type: null,
    why: 'An after-event due date — the rule is due_days_after_event, which is why it counts forward from the target date.',
    items: [
      { ord: 1, label: 'Prepare financial report', hint: "keep sample forms on your org's shared Drive" },
      { ord: 2, label: 'Submit to the audit office', rule_json: { due_days_after_event: 7 } },
      { ord: 3, label: 'Confirm whether the auditor also signs', required: false },
    ],
  },
  {
    name: 'Extension Activity',
    track: 'both',
    event_type: 'ces',
    why: "Scoping a template to one event type means it never lands on the wrong project — that's when to use the event-type field instead of a flag.",
    items: [
      { ord: 1, label: 'Concept paper routed on the extension chain (includes the extension coordinator)' },
      { ord: 2, label: 'Previous extension activity reports ready for the coordinator' },
      { ord: 3, label: 'Funding request letter to the student government — frame under the SDGs' },
    ],
  },
];

/** The who-to-ask directory — generic placeholders; the point is showing
 *  what a useful contact row looks like, not who to actually ask. */
export const STARTER_CONTACTS = [
  { label: 'Templates & forms', value: "Your org's shared Drive folder", category: 'Forms' },
  { label: 'Venue & equipment bookings', value: 'Facilities / admin office', category: 'Places' },
  { label: 'Financial reports', value: 'Your auditor & treasurer', category: 'People' },
  { label: 'Paper routing questions', value: 'Your adviser or a senior officer', category: 'People' },
];

/** Everything, for "Add everything". */
export const STARTER_PACK = {
  chains: STARTER_CHAINS,
  templates: STARTER_TEMPLATES,
  contacts: STARTER_CONTACTS,
};

/** Flag vocabulary the library establishes: has_merch, off_campus. */
