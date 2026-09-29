# SWE-2 Max Prompt — CounciLog: proper chains & templates, a starter library, and the guide

You are a senior product engineer. CounciLog's workflow engine is finished and
correct — the API already accepts `office` + `condition_json` on signatory
steps, `hint` / `required` / `rule_json` on checklist items, and
`flags` on document creation. But the **Settings editors are a stub**: they
take one label per line and nothing else. Owners cannot express the handbook's
conditional steps (RFP for international webinars, Marketing for merch, Sir
Bennyl for CES), due-date rules (CHED 15 days, CHECK 1 week), or even edit or
delete a template they typo'd. `USER_GUIDE.md` currently documents a "Skip
with reason" workaround for this gap — this task deletes the workaround.

Your mission, in four parts:

1. **Full editors** — Settings → templates and Settings → chains become real
   editors: every field the API accepts, editable rows, reorder, edit, delete.
2. **Working flags** — `include_if_flag` conditions are dead today:
   `ProjectIn.flags` is accepted then silently dropped (`projects` has no
   `flags` column), and no form sends document flags. Wire flags end-to-end.
3. **Starter library** — a browsable set of handbook-derived example chains,
   templates, and contacts that any member can study and an owner can install
   into the org with one tap. Once loaded they are **ordinary org rows** —
   renamed, reordered, and edited through the normal editors. The library is
   deliberately a teaching artifact: it shows users what a well-built chain
   or template looks like before they write their own.
4. **The guide** — a plain-language explanation of how chains and templates
   actually work (matching rules, conditions, snapshots, gotchas), shipped
   **in-app** as a `/guide` page and synced into `v2/USER_GUIDE.md`. The
   starter library lives inside it as the worked examples.

Work at the repo root (`CouncilLogV2/`). App code lives in `v2/web/` +
`v2/api/` + `v2/supabase/migrations/`.

---

## §1 Read before you touch anything

1. `v2/PRODUCT.md` — audience (student officers on phones), plain-language
   voice, "org-shaped, not org-coded" principle.
2. `v2/DESIGN.md` — tokens, primitives, four-variant theme system. Source of
   truth for styling.
3. `v2/spec.md` — §3.4–3.6 (features), §4 (data model), §5 (API inventory —
   your new endpoints extend #31 and #36), §7 (configurable workflow), §9
   (seed data plan — the starter library below is derived from it).
4. `COUNCIL_HANDBOOK_V2.md` — the domain source. §3–§4 (concept papers +
   signatories), §5 (board resolution = same signatories minus SSC
   President), §7 (financial report → CHECK, 1 week), §9 (venue rules), §10
   (events checklist), §12 (outside events/CHED), §13 (CES/Sir Bennyl), §15
   (who-to-ask directory).
5. `v2/api/app/services/instantiate.py` — the rules engine. `rule_json` keys:
   `due_days_before_event`, `due_days_after_event`, `include_if_event_type`,
   `exclude_if_event_type`, `include_if_flag`. `condition_json` keys on
   steps: `include_if_event_type`, `include_if_flag`. **These are the only
   supported rule shapes — the editors must produce exactly these.**
6. `v2/web/src/lib/rules.js` — the client mirror used for previews. Keep it
   in sync with `instantiate.py` (it currently passes `flags={}` inside
   `templateItems`/`diagnoseChecklist` — you'll thread real flags through).
7. `v2/api/app/routers/projects.py` — `TemplateIn`/`TemplateItemIn`, the
   `instantiate` route (note: it inserts unconditionally — see WP2.5), and
   the `flags` drop bug in `create_project`/`patch_project`.
8. `v2/api/app/routers/documents.py` — `ChainIn`/`StepIn`, document creation
   (event_type comes from the **linked project** — `proj.event_type` —
   which is why WP3 needs a project picker), `attach_chain` (passes
   `flags={}` — WP2 fixes this), the revision rounds machinery.
9. `v2/api/app/models.py` — `ChecklistTemplate(Item)`, `SignatoryChain`,
   `SignatoryStep`, `Project`, `Document`. No `flags` columns yet.
10. `v2/web/src/pages/Settings.jsx` — the `Templates` and `Chains` stub
    editors you'll replace (~lines 224–387).
11. `v2/web/src/components/ChecklistPreview.jsx`,
    `v2/web/src/pages/Documents.jsx` (`ChainPreview`),
    `v2/web/src/pages/Projects.jsx`, `v2/web/src/pages/ProjectDetail.jsx` —
    the create/preview surfaces that consume rules.
12. `v2/web/src/components/ui.jsx` — reuse `Button`, `Input`, `Select`,
    `Field`, `Card`, `Chip`, `Empty`, `ErrorState`, `HintBanner`, `Skeleton`,
    `Sheet`, `ConfirmDialog`. `AppShell.jsx` `NAV` for the Guide nav item.
13. `v2/supabase/migrations/0001_init.sql` (FK style + RLS pattern) and
    `0004_document_revisions.sql` (comment-header + alter style). Highest
    migration number is `0006`; yours is `0007`.
14. `v2/USER_GUIDE.md` — A1 steps 5–7 (manual entry you'll replace), A6
    (workaround you'll delete), "Known gaps" (you close two of them).
15. If the `impeccable` skill is installed: run
    `impeccable context --target v2/web` once at session start, and read
    `reference/craft-floor.md` before your first UI edit. If not installed,
    skip silently.

---

## §2 Hard constraints — violations are regressions

- **Plain JavaScript/JSX.** No TypeScript, no `.ts`/`.tsx`, no type deps.
- **No new dependencies.** `lucide-react` is already installed.
- **Token-driven styling.** `var(--*)` only — no literal hex, no `bg-white`.
  All four theme variants stay WCAG AA; ≥44px touch targets; usable at 360px.
- **Thin client.** All rule evaluation stays server-side in
  `instantiate.py`; `rules.js` exists only to preview what the server will
  do. Never add a rule shape the server doesn't already evaluate.
- **No raw JSON in the UI.** Owners pick conditions from dropdowns
  ("always / only for event type… / only when flag…"); the editor builds the
  `rule_json`/`condition_json`. If a user can type JSON, the UI failed.
- **Owner-only writes.** Template/chain mutations stay `authorize("owner")`;
  the read views stay member-visible. Audit every mutation.
- **Snapshot semantics are sacred.** Template/chain edits and deletes must
  never rewrite a live project's checklist or a routed document's steps.
- **Plain language.** "Who signs, in order", not "signatory chain DSL".
  Preview before commit; every empty state names the cause and the next
  step (repo `AGENTS.md`).
- **No secrets, no AI/tool attribution** (repo `AGENTS.md`). Handbook names
  live only in `starterPack.js` data and the guide — never in logic,
  validation, or schema constraints. Every library entry is presented as an
  **example to adapt**, not gospel — its `why` note says what makes it tick.

---

## §3 Work packages

### WP1 — Migration `v2/supabase/migrations/0007_template_workflows.sql`

1. `projects` and `documents` each gain `flags jsonb not null default '{}'`.
2. `project_checklist_items.template_id` — drop the existing FK constraint
   and re-add it `on delete set null`. Rationale: spec §3.6 says deleting a
   template keeps instantiated checklists intact; the items are snapshots,
   only the provenance pointer clears.
3. `models.py`: add `flags: dict[str, Any] | None` (JSONB, default `{}`) to
   `Project` and `Document`.
4. No RLS changes needed — no new tables. Match the comment-header style of
   `0004`.

### WP2 — API (`projects.py`, `documents.py`)

1. **`PATCH /orgs/{o}/checklist-templates/{id}`** — owner. Optional
   `name`/`track`/`event_type`; optional `items` list — when provided,
   delete existing items and insert the new set in the same transaction.
   404 on cross-org. Audit `template.updated`.
2. **`DELETE /orgs/{o}/checklist-templates/{id}`** — owner. Succeeds even
   when instantiated (the SET NULL FK keeps instances); audit
   `template.deleted` with `metadata={name, instances: <count of
   project_checklist_items referencing it>}`.
3. **`PATCH`/`DELETE /orgs/{o}/signatory-chains/{id}`** — same shape;
   `steps` wholesale-replaced when provided. Document steps are snapshots
   with no FK back, so delete is always safe. Audit `chain.updated` /
   `chain.deleted`.
4. **Persist flags.** `create_project`/`patch_project`: stop excluding
   `flags` — write to the new column. `create_document`: write
   `body.flags` to `doc.flags`; when `flags` is empty AND the doc links a
   project, inherit `proj.flags`. `attach_chain`: evaluate conditions with
   `doc.flags` instead of `{}`. `instantiate` route: pass
   `flags=p.flags or {}` into `instantiate_checklist`.
5. **Instantiate guard.** `InstantiateBody` gains `append: bool = false`.
   When the project already has checklist items and `append` is false →
   `409 ALREADY_INSTANTIATED` with the existing count in `message`. Today a
   second call duplicates every item — the guard makes re-runs explicit.
6. List/detail responses: `flags` rides along via `model_dump` — verify it
   surfaces on `GET /projects/{id}` and `GET /documents/{id}`.

### WP3 — Web: real editors (`Settings.jsx` + supporting components)

The stub editors (newline-separated labels) are replaced. Extract the new
editors to `v2/web/src/components/TemplateEditor.jsx` and
`ChainEditor.jsx` if Settings.jsx gets unwieldy — maintainer is JS-only,
favor obvious code.

1. **Template editor** (Sheet): name, `track` select (`paper`/`logistics`/
   `both` with plain-language subtitles), `event_type` datalist (blank =
   every event). Item rows, each with:
   - `label` input
   - `hint` input (one line: where to go / what to watch for)
   - "optional" toggle → `required: false` (subtitle: "won't block — it's a
     reminder")
   - **When** select: `always` | `only for event type…` |
     `not for event type…` | `only when flag…` — the last three reveal a
     datalist input for the value; produces `include_if_event_type` /
     `exclude_if_event_type` / `include_if_flag` in `rule_json`.
   - **Due** select: `no due date` | `N days before the event` |
     `N days after the event` + number input →
     `due_days_before_event`/`due_days_after_event`. Hint: "needs the
     project to have a target date, or no due date is computed".
   - When + Due combine in one `rule_json`. Reorder (up/down buttons —
     drag is optional), delete row, add row.
2. **Chain editor** (Sheet): name, `doc_type` datalist (existing doc types
   + the standard set). Step rows: `label`, `office` (subtitle: "where the
   desk physically is"), **When** select: `always` | `only for event
   type…` | `only when flag…` → `condition_json`. Reorder, delete, add.
3. **Edit & delete.** Each existing template/chain gets Edit (reopens the
   sheet pre-filled → PATCH) and Delete (`ConfirmDialog`; template delete
   warns "projects already generated from this keep their copies — only the
   template goes away").
4. **Flags UI.** Derive the flag vocabulary by scanning all chains'
   `condition_json` and templates' `rule_json` for `include_if_flag` values.
   A shared `FlagCheckboxes` component renders one checkbox per known flag
   (label = humanized key: `has_merch` → "Has merch — shirts/sales",
   `off_campus` → "Held off-campus"); if no flags are referenced anywhere,
   render nothing. Wire it into:
   - **Projects** create/edit sheet → stored via `flags` (needs WP2.4).
   - **Documents** register sheet → sent as `flags`.
   - Both previews (`ChecklistPreview`, `ChainPreview`) receive the live
     flag state so a ticked flag visibly adds its conditional items/steps.
5. **Project picker on document registration** — add an optional "Linked
   project" select to the New document sheet (`project_id` already exists on
   `DocIn`). **This is load-bearing, not optional:** the RFP-style
   `include_if_event_type` steps only fire when the document inherits the
   project's `event_type`. The `ChainPreview` then gets the real event_type
   too. On pick, also adopt the project's flags as the default checkbox
   state.
6. **Read-only views.** Non-owners still see the lists — render hints,
   offices, and rules in words ("only when the event type is webinar_intl",
   "due 15 days before the event"), not JSON.
7. **Instantiate guard UX.** `ProjectDetail` — when the checklist already
   has items, "Generate" isn't shown (already true); the force-pick
   Generate path passes `append: true` after a `ConfirmDialog` explaining
   it adds duplicates on purpose.
8. `rules.js`: thread `flags` through `templateItems` and
   `diagnoseChecklist` (both currently hardcode `{}`); stay exactly aligned
   with `instantiate.py`.

### WP4 — Starter library (`web/src/lib/starterPack.js` + Guide)

`starterPack.js` exports `{ chains, templates, contacts }` — plain JS data
built from the handbook, **plus a `why` field on every entry** (one sentence
explaining the design idea it demonstrates — e.g. "the RFP step is a
condition, not a separate chain, because the route is identical except for
one office"). The library is the guide's worked-examples section — it lives
on the `/guide` page (WP5), not buried in Settings.

Library UX:

- **Browse = everyone.** Any member can open `/guide` and expand a library
  entry to read its full contents — every step with its office, every item
  with its hint, and every condition translated to a sentence ("only when
  the event type is `webinar_intl`"). Reading a library entry should teach
  someone to build their own — that's its primary job.
- **Install = owner.** Each entry gets "Add to my org"; a header action
  offers "Add everything". Non-owners see a one-line "owners can add these
  to the org" note instead of dead buttons.
- **Preview before commit** (AGENTS.md): tapping Add opens a `Sheet` showing
  exactly what will be created, then POSTs through the existing endpoints.
  Sequential creates → invalidate `['templates','chains','contacts']` →
  toast "Added — it's yours now; edit it in Settings → chains/templates."
- **Nothing is special after install.** A library entry creates normal
  `checklist_templates`/`signatory_chains`/`org_contacts` rows — the user
  edits or deletes them like anything they typed by hand. The library entry
  itself stays in the guide as reference; deleting your copy doesn't remove
  the example. Say this plainly on the entry ("this is a starting point —
  load it, then change whatever doesn't fit").
- **Idempotent.** Entries already present (name match, case-insensitive)
  render "already in your org" and the Add button becomes a link to the
  matching Settings tab. Deleting your copy restores the Add button.
- **Settings cross-links.** The templates and chains tabs keep a small card
  on top: "New here? The Guide has worked examples you can load and adapt"
  → `/guide#library`.

**Library content** (use exactly this; offices/notes come from the handbook
— each `why` is the teaching sentence shown with the entry):

Chains:

- `concept_paper` — "Standard Concept Paper" — *why:* "the plain route is
  three desks; the RFP and Marketing steps are conditions, not separate
  chains, because the route is identical except for those offices":
  1. SSC President — office: "2nd floor hallway, office on the left side"
  2. SAS routing — Ma'am Ana — "2nd floor hallway, at the end (routes the
     paper to Ma'am Vincoy)"
  3. RFP signatory — condition `{"include_if_event_type":"webinar_intl"}` —
     "international webinars only; confirm current routing with Ma'am Feb"
  4. Marketing Dept + Bookstore — condition `{"include_if_flag":"has_merch"}`
     — "Marketing office, beside the SSC office — only for merch activities"
  5. School Director — "2nd floor corner office (the one with the window)"
- `board_resolution` — "Board Resolution" — *why:* "a whole doc type whose
  route is 'the concept paper chain minus one desk' gets its own chain —
  chains are matched by doc type, so copy the steps and drop the one that
  doesn't apply". Same five minus SSC President (SAS first; RFP + Marketing
  steps keep their conditions; SD last).
- `ces_concept_paper` — "CES Concept Paper" — *why:* "a different doc type
  (`ces_concept_paper`) means CES papers get their own route automatically —
  and Sir Bennyl's office line doubles as a reminder to bring last event's
  reports". SSC President → SAS (Ma'am Ana) → Sir Bennyl — "2nd floor right
  side, across the kids' library — bring the previous CES event's activity
  reports (his office or the 2025–2026 JPCS Binder)" → School Director.
- `financial_report` — "Financial Report" — *why:* "even a one-office route
  is worth a chain — the office note carries the 1-week deadline nobody
  remembers". Single step CHECK — "submit within 1 week after the event;
  confirm at submission whether CHECK signs".

Templates:

- "Concept Paper Pack" — track `paper`, no event_type — *why:* "a hint on
  every item so the checklist teaches as it goes; speaker items and the
  supplier letter are marked optional instead of deleted because they only
  apply sometimes":
  1. "Confirm the event date" — hint: "not within 1 week before or during
     exam week — you only get ~2-week windows"
  2. "Summary letter"
  3. "Board resolution" — hint: "same signatories as the concept paper
     minus the SSC President; always submitted together, never alone"
  4. "Concept paper (new format)" — hint: "first page must be filled every
     time; template + samples on the council Drive; budget from the bank
     book"
  5. "Speaker's CV" — optional, hint "events with a guest speaker"
  6. "Speaker's certificates" — optional, same hint
  7. "Justification letter — outside supplier" — optional, hint "only when
     buying from an outside supplier instead of the school canteen"
- "Event Logistics" — track `logistics`, no event_type — *why:* "the venue
  item shows a due-date rule in action, and the two Zoom items show
  per-item event-type gates — the same line twice, once per event type":
  committees, tarpaulin, food (committees/faculty/speaker; participants for
  competitions), venue (hint: "GSD in person after papers are done — target
  ~1 month out; gym pencil bookings lapse in 3 days; IHM is first-come
  first-served"; due `30` days before event), sound system + mic (hint:
  "from the CCS Office when the venue is a computer lab"), transport (hint:
  "van via GSD; bus via AR Travel for big trips"), registration forms,
  certificates (participants + guest speaker), pubmats (hint: "poster for
  Facebook + invitation for the faculty"), **and two webinar-only items**:
  "Zoom link from ITS" gated `include_if_event_type: webinar` and the same
  gated `webinar_intl` (hint: "Google Form via Ma'am Feb").
- "Outside Event Pack" — track `both`, no event_type — *why:* "one flag
  (`off_campus`) covers outside events AND educ tours without listing every
  event type — tick one checkbox on the project and the whole pack
  appears"; **every item gated `include_if_flag: off_campus`**:
  "CHED letter (CHED CMO No. 63 s. 2017 format)" — due `15` days before
  event, hint "hard copy to City Hall Compound AND emailed — get CHED's
  email from Ma'am Lily at the Registrar; 15 days is the floor, target a
  month"; "Participant list + parents' consent"; "Curriculum forms — one
  per course, relevant subjects highlighted"; "Medical checkup letter —
  Ma'am Vincoy signs"; "Van request — form from the GSD".
- "Financial Report" — track `paper` — *why:* "an *after*-event due date —
  the rule is `due_days_after_event`, which is why it counts forward from
  the target date": prepare report (hint: "sample forms on the council
  Drive"), "Submit to CHECK" — due `7` days **after** event, "Confirm
  whether CHECK is also a signatory" — optional.
- "CES Activity" — track `both`, event_type `ces` — *why:* "scoping a
  template to one event type means it never lands on the wrong project —
  that's when to use the event-type field instead of a flag": "Concept
  paper routed on the CES chain (includes Sir Bennyl)", "Previous CES
  activity reports ready for Sir Bennyl", "SSC proposal letter for
  funding — frame under the SDGs".

Contacts (the §15 directory — same fields as today): Templates & forms →
Council Google Drive; concept paper/activity report → Ate Daphne; financial
reports → Ate Bella/Jade/Christel; SAS routing → Ma'am Ana; SD signature →
2nd floor corner office; SSC President → 2nd floor left; venue/van → GSD in
person; gym pencil booking → Coach (varsity room); CES signatory → Sir
Bennyl; CHED questions → Ma'am Ana or SSC President Cez; CHED email →
Ma'am Lily (Registrar); medical letter → Ma'am Vincoy; RFP/Zoom → Ma'am
Feb; sound system → CCS Office; bus rental → AR Travel.

**Flag vocabulary this establishes:** `has_merch`, `off_campus`.

### WP5 — The guide (in-app + repo)

1. **`v2/web/src/pages/Guide.jsx`** — new `/guide` route, nav item "Guide"
   (`BookOpen`/`CircleHelp` lucide icon, NOT admin-gated). Read-mode page:
   comprehension first. Sections:
   - **What a chain is** — who signs a paper, in order. What a template is
     — a reusable checklist that a project copies when it's created.
   - **How matching actually works** — the non-obvious rules, in words:
     - A paper routes by its **document type** matching a chain's doc type
       *exactly* — `Concept Paper` ≠ `concept_paper`. Two chains on the
       same type → the alphabetically-first name wins; the override picker
       exists for a reason.
     - A template lands on a project when the **track** matches its needs
       (papers / logistics / both) AND its event type matches — or the
       template has no event type, which means "every event".
     - A project with a blank event type only picks up untyped templates.
     - `include_if_flag` items/steps need the matching checkbox ticked on
       the project or document — and the checkbox only exists because some
       template or chain uses that flag name.
     - `only for event type` steps need the document **linked to a
       project** with that event type (that's why the register sheet asks).
     - "due N days before/after" only computes when the project has a
       target date.
     - Conditions are read **once, at creation**. Editing a template later
       never rewrites a live checklist or a routed paper — that's the
       snapshot guarantee. To fix a live checklist, edit its items
       directly (or regenerate with "append" knowing it duplicates).
     - Steps aren't a gate — any officer can mark any pending step; it's a
       custody record. Skipping needs a reason. Sent-back papers open a
       new round; nothing is ever erased.
     - A paper registered with no matching chain still gets its custody
       log — attach a chain later from its detail page.
     - New orgs start empty; the starter library is a set of **examples** —
       adding one creates a completely ordinary template/chain you can edit
       or delete. Nothing loaded from the library is locked or special.
     - Standardize `doc_type`/`event_type` spellings early — matching is
       literal strings (`webinar_intl`, not `intl-webinar`).
   - **The starter library** (`#library`) — the WP4 content rendered as
     expandable worked examples: each entry shows its full steps/items with
     conditions translated to sentences and its `why` teaching note, plus
     the owner-only "Add to my org" / "Add everything" actions described in
     WP4. This section is the answer to "show me what a good one looks
     like" — reading an entry should be enough to build your own.
   - **Building a chain step by step** — name → doc type → steps in
     signing order → conditions. Points at the Standard Concept Paper
     library entry as the worked example, including why the RFP step is a
     condition and not a separate chain.
   - **Building a template step by step** — name → track → event type →
     items with hints, optional flags, due rules. Worked example: the
     Outside Event Pack and why its items use the `off_campus` flag
     instead of an event type (one flag covers outside + educ_tour).
   - **Troubleshooting** — "my project generated nothing" mapped to the
     diagnosis reasons; "my paper didn't route" → check doc_type spelling,
     then attach a chain.
2. **Link it where confusion happens:** Settings templates/chains tab
   headers ("how do these work?"), the `ChainPreview` no-match warning, the
   `ChecklistPreview` diagnosis reasons (small "how matching works" link to
   `/guide`), and the library cross-link cards from WP4.
3. **`v2/USER_GUIDE.md` sync:** A1 steps 5–6 rewritten around browsing the
   guide's library, loading the entries that fit, and editing them to taste;
   A6's Skip-workaround replaced with the real conditions (keep the CHED
   two-channel note); add a "How matching works" section mirroring the
   in-app rules above; update "Known gaps" (the rules-engine-UI and no-seed
   items are resolved; template snapshots note stays).
4. **Docs:** `spec.md` §5 gains the four new endpoints + `append` + `flags`
   fields; §7 notes flags persist on projects/documents. `DESIGN.md` gets
   one line: `/guide` is the app's first Read-mode surface. `ROLES.md`:
   verify owner-only writes still accurate — verify, don't assume.

### WP6 — Tests (`v2/api/tests/`)

Extend `test_instantiate.py` style (or a new `test_template_crud.py`
following `test_authz.py` conventions):

- PATCH template renames + replaces items; DELETE frees instances
  (`template_id` → null, items intact); both 404 cross-org and 403
  non-owner.
- Chain PATCH/DELETE same; deleting a chain doesn't touch routed documents.
- Project with `flags={"off_campus": true}` → flag-gated items instantiate;
  without → they don't.
- Document `include_if_flag` step appears when `flags` set; `attach_chain`
  respects `doc.flags`; event-type step appears only via linked project's
  `event_type`.
- Re-instantiate without `append` → `409 ALREADY_INSTANTIATED`; with
  `append` → duplicates as declared.
- Cross-org isolation on all four new endpoints (mandatory per spec §8.2).

---

## §4 Acceptance criteria — the pass/fail list

- [ ] `cd v2/web && npm run build` passes; `pytest` passes (or additions
      flagged "requires running stack").
- [ ] Migration 0007 applies cleanly; no `.ts`/`.tsx`; no new deps; no
      literal hex in components; all four themes hold at 360px and 1280px.
- [ ] Owner creates a chain with an event-type-conditional step and a
      flag-conditional step entirely in the UI — no JSON touched — and the
      register-document preview reflects both correctly.
- [ ] Owner edits (reorders steps, renames, adds/removes an item with a due
      rule) and deletes templates/chains; delete preserves instantiated
      checklists.
- [ ] Any member can browse the library on `/guide` and read every entry's
      steps, conditions, and `why` note — no write powers needed.
- [ ] Owner adds a single library entry → it appears as a completely
      ordinary chain/template, editable and deletable through the new
      editors; deleting the org copy restores its Add button. Entries
      already present show "already in your org" instead of duplicating.
- [ ] A `webinar_intl` project's linked concept paper shows the RFP step;
      a plain seminar's does not. An `off_campus`-flagged project gets the
      Outside Event Pack items; unflagged doesn't. CHED letter lands 15
      days before target date; CHECK item 7 days after.
- [ ] Re-generating a populated checklist returns the 409; the force-pick
      path confirms before appending.
- [ ] `/guide` exists in nav, renders all sections, and is linked from the
      Settings tabs, the no-match warning, and the checklist diagnosis.
- [ ] `USER_GUIDE.md`/`spec.md` synced; no secrets; no tool attribution.

---

## §5 Verification sequence

1. `npm run build` (web) — must pass before claiming done.
2. `pytest` — report tails; smoke additions if a live stack exists.
3. Manual smoke: browse the library as a non-owner; as owner, add one
   library entry, edit a step in it, delete another entry, re-add it;
   register a concept paper linked to a `webinar_intl` project → RFP step
   present; edit a chain in the editor and confirm a routed doc is
   untouched; delete a used template and confirm the project's checklist
   survives; walk `/guide` links from each surface.
4. If `impeccable` is installed: `impeccable detect --json` on changed web
   files; fix real findings, skip noise contradicting §2.

---

## §6 Out of scope

Per-office authentication, enforced signing order, editing a chain
mid-flight on a live document, checklist item add/remove on an instantiated
project (bigger feature — note in future polish), template versioning,
import/export of library sets across orgs, per-org authoring of library
entries, notifications, and any new dependency. Note deliberately-deferred ideas in a short "future polish"
section of your report — don't sneak them in.

## Output format

1. Ordered list of files changed/created with a one-line "why" each.
2. Build + test output tails.
3. The §4 checklist with actual pass/fail results.
4. Any deviation from §3 (and why).
5. Short future-polish notes.
