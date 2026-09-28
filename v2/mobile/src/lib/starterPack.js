/** Starter library — handbook-derived example chains, templates, and
 *  contacts (COUNCIL_HANDBOOK_V2.md). Browsable by every member on /guide;
 *  an owner can install entries as completely ordinary org rows — nothing
 *  loaded is locked or special, edit and delete them like hand-typed ones.
 *
 *  Every entry carries `why` — one sentence on the design idea it
 *  demonstrates, because the library's primary job is teaching people what
 *  a well-built chain/template looks like before they write their own. */

export const STARTER_CHAINS = [
  {
    name: 'Standard Concept Paper',
    doc_type: 'concept_paper',
    why: 'The plain route is three desks; the RFP and Marketing steps are conditions, not separate chains, because the route is identical except for those offices.',
    steps: [
      { ord: 1, label: 'SSC President', office: '2nd floor hallway, office on the left side' },
      { ord: 2, label: "SAS routing — Ma'am Ana", office: "2nd floor hallway, at the end (routes the paper to Ma'am Vincoy)" },
      { ord: 3, label: 'RFP signatory', office: "international webinars only; confirm current routing with Ma'am Feb",
        condition_json: { include_if_event_type: 'webinar_intl' } },
      { ord: 4, label: 'Marketing Dept + Bookstore', office: 'Marketing office, beside the SSC office — only for merch activities',
        condition_json: { include_if_flag: 'has_merch' } },
      { ord: 5, label: 'School Director', office: '2nd floor corner office (the one with the window)' },
    ],
  },
  {
    name: 'Board Resolution',
    doc_type: 'board_resolution',
    why: "A whole doc type whose route is 'the concept paper chain minus one desk' gets its own chain — chains are matched by doc type, so copy the steps and drop the one that doesn't apply.",
    steps: [
      { ord: 1, label: "SAS routing — Ma'am Ana", office: "2nd floor hallway, at the end (routes the paper to Ma'am Vincoy)" },
      { ord: 2, label: 'RFP signatory', office: "international webinars only; confirm current routing with Ma'am Feb",
        condition_json: { include_if_event_type: 'webinar_intl' } },
      { ord: 3, label: 'Marketing Dept + Bookstore', office: 'Marketing office, beside the SSC office — only for merch activities',
        condition_json: { include_if_flag: 'has_merch' } },
      { ord: 4, label: 'School Director', office: '2nd floor corner office (the one with the window)' },
    ],
  },
  {
    name: 'CES Concept Paper',
    doc_type: 'ces_concept_paper',
    why: "A different doc type (ces_concept_paper) means CES papers get their own route automatically — and Sir Bennyl's office line doubles as a reminder to bring last event's reports.",
    steps: [
      { ord: 1, label: 'SSC President', office: '2nd floor hallway, office on the left side' },
      { ord: 2, label: "SAS routing — Ma'am Ana", office: '2nd floor hallway, at the end' },
      { ord: 3, label: 'Sir Bennyl (CES)', office: "2nd floor right side, across the kids' library — bring the previous CES event's activity reports (his office or the 2025–2026 JPCS Binder)" },
      { ord: 4, label: 'School Director', office: '2nd floor corner office (the one with the window)' },
    ],
  },
  {
    name: 'Financial Report',
    doc_type: 'financial_report',
    why: 'Even a one-office route is worth a chain — the office note carries the 1-week deadline nobody remembers.',
    steps: [
      { ord: 1, label: 'CHECK', office: 'submit within 1 week after the event; confirm at submission whether CHECK signs' },
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
      { ord: 3, label: 'Board resolution', hint: 'same signatories as the concept paper minus the SSC President; always submitted together, never alone' },
      { ord: 4, label: 'Concept paper (new format)', hint: 'first page must be filled every time; template + samples on the council Drive; budget from the bank book' },
      { ord: 5, label: "Speaker's CV", required: false, hint: 'events with a guest speaker' },
      { ord: 6, label: "Speaker's certificates", required: false, hint: 'events with a guest speaker' },
      { ord: 7, label: 'Justification letter — outside supplier', required: false, hint: 'only when buying from an outside supplier instead of the school canteen' },
    ],
  },
  {
    name: 'Event Logistics',
    track: 'logistics',
    event_type: null,
    why: 'The venue item shows a due-date rule in action, and the two Zoom items show per-item event-type gates — the same line twice, once per event type.',
    items: [
      { ord: 1, label: 'Committees formed' },
      { ord: 2, label: 'Tarpaulin' },
      { ord: 3, label: 'Food', hint: 'committees/faculty/speaker; participants for competitions' },
      { ord: 4, label: 'Venue booked', hint: 'GSD in person after papers are done — target ~1 month out; gym pencil bookings lapse in 3 days; IHM is first-come first-served',
        rule_json: { due_days_before_event: 30 } },
      { ord: 5, label: 'Sound system + mic', hint: 'from the CCS Office when the venue is a computer lab' },
      { ord: 6, label: 'Transport', hint: 'van via GSD; bus via AR Travel for big trips' },
      { ord: 7, label: 'Registration forms' },
      { ord: 8, label: 'Certificates', hint: 'participants + guest speaker' },
      { ord: 9, label: 'Pubmats', hint: 'poster for Facebook + invitation for the faculty' },
      { ord: 10, label: 'Zoom link from ITS', hint: 'Google Form via Ma\'am Feb',
        rule_json: { include_if_event_type: 'webinar' } },
      { ord: 11, label: 'Zoom link from ITS', hint: 'Google Form via Ma\'am Feb',
        rule_json: { include_if_event_type: 'webinar_intl' } },
    ],
  },
  {
    name: 'Outside Event Pack',
    track: 'both',
    event_type: null,
    why: 'One flag (off_campus) covers outside events AND educ tours without listing every event type — tick one checkbox on the project and the whole pack appears.',
    items: [
      { ord: 1, label: 'CHED letter (CHED CMO No. 63 s. 2017 format)', hint: "hard copy to City Hall Compound AND emailed — get CHED's email from Ma'am Lily at the Registrar; 15 days is the floor, target a month",
        rule_json: { include_if_flag: 'off_campus', due_days_before_event: 15 } },
      { ord: 2, label: "Participant list + parents' consent",
        rule_json: { include_if_flag: 'off_campus' } },
      { ord: 3, label: 'Curriculum forms — one per course, relevant subjects highlighted',
        rule_json: { include_if_flag: 'off_campus' } },
      { ord: 4, label: "Medical checkup letter — Ma'am Vincoy signs",
        rule_json: { include_if_flag: 'off_campus' } },
      { ord: 5, label: 'Van request — form from the GSD',
        rule_json: { include_if_flag: 'off_campus' } },
    ],
  },
  {
    name: 'Financial Report',
    track: 'paper',
    event_type: null,
    why: 'An after-event due date — the rule is due_days_after_event, which is why it counts forward from the target date.',
    items: [
      { ord: 1, label: 'Prepare financial report', hint: 'sample forms on the council Drive' },
      { ord: 2, label: 'Submit to CHECK', rule_json: { due_days_after_event: 7 } },
      { ord: 3, label: 'Confirm whether CHECK is also a signatory', required: false },
    ],
  },
  {
    name: 'CES Activity',
    track: 'both',
    event_type: 'ces',
    why: "Scoping a template to one event type means it never lands on the wrong project — that's when to use the event-type field instead of a flag.",
    items: [
      { ord: 1, label: 'Concept paper routed on the CES chain (includes Sir Bennyl)' },
      { ord: 2, label: "Previous CES activity reports ready for Sir Bennyl" },
      { ord: 3, label: 'SSC proposal letter for funding — frame under the SDGs' },
    ],
  },
];

/** The handbook's who-to-ask directory (§15) — plain contacts, same fields
 *  the Settings contacts editor uses. */
export const STARTER_CONTACTS = [
  { label: 'Templates & forms', value: 'Council Google Drive', category: 'Forms' },
  { label: 'Concept paper / activity report questions', value: 'Ate Daphne', category: 'People' },
  { label: 'Financial reports', value: 'Ate Bella / Jade / Christel', category: 'People' },
  { label: 'SAS routing', value: "Ma'am Ana — 2nd floor hallway, at the end", category: 'People' },
  { label: 'School Director signature', value: '2nd floor corner office (the one with the window)', category: 'Places' },
  { label: 'SSC President', value: '2nd floor hallway, office on the left side', category: 'People' },
  { label: 'Venue & van requests', value: 'GSD — in person', category: 'Places' },
  { label: 'Gym pencil booking', value: 'Coach — varsity room (bookings lapse in 3 days)', category: 'Places' },
  { label: 'CES signatory', value: "Sir Bennyl — 2nd floor right side, across the kids' library", category: 'People' },
  { label: 'CHED questions', value: "Ma'am Ana or SSC President Cez", category: 'People' },
  { label: 'CHED email address', value: "Ma'am Lily — Registrar", category: 'People' },
  { label: 'Medical checkup letter', value: "Ma'am Vincoy signs", category: 'People' },
  { label: 'RFP / Zoom links', value: "Ma'am Feb", category: 'People' },
  { label: 'Sound system & mic', value: 'CCS Office', category: 'Places' },
  { label: 'Bus rental', value: 'AR Travel', category: 'Places' },
];

/** Everything, for "Add everything". */
export const STARTER_PACK = {
  chains: STARTER_CHAINS,
  templates: STARTER_TEMPLATES,
  contacts: STARTER_CONTACTS,
};

/** Flag vocabulary the library establishes: has_merch, off_campus. */
