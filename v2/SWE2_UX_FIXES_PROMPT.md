# SWE-2 Max Prompt — CounciLog: density fix, editable checklists, photo edits, re-sign, status transitions

You are a senior product engineer. The CounciLog ecosystem is live: FastAPI
(`v2/api`), React+Vite web (`v2/web`), Expo app (`v2/mobile`), static
landing (`v2/landing`). Real-use testing on phone-sized screens surfaced
six problems. The screenshots that motivated this were the **deployed web
app at ~390px width** — but the RN app mirrors the same screens, so every
UI fix lands on **both** clients.

Your mission, six work packages plus tests:

1. **Density pass** — rows and action clusters crush each other at phone
   width: journal card footers, checklist rows (the assignee `<select>`
   squeezes the label to one word per line), signatory step cards.
2. **Editable checklists** — items are currently write-once: no add,
   rename, delete, due-date, or reorder anywhere, and the create form's
   preview is read-only and gated behind "Needs papers / Needs logistics"
   checkboxes. Checklists must be editable before create (template pick +
   tweak the merged list) and after create (full item CRUD).
3. **Photo editing** — journal entries and paper movements both say
   "Photos can't be changed — delete and re-file." Now they can: add,
   remove, and (for movements) replace.
4. **Checklist filters + casing** — filter a project's checklist by
   done/open/mine/unassigned; stop leaking raw enums into the UI
   (`unassigned`, `concept_paper`, `draft`, `not recorded yet`).
5. **Return-to-step re-sign** — a paper mid-route can only be sent back
   from a *pending* step, and doing so **silently drops the other pending
   steps** off the route. Officers need to send a signed paper *back to
   an earlier step* without losing the rest of the route.
6. **Project status transitions** — the API accepts `status` on
   `PATCH /projects/{id}` but no UI exposes it. Projects are stuck in
   `draft` forever.

**Much of this is wiring, not building.** The revision-rounds engine
(`POST /documents/{id}/revisions`, `round_no`, `superseded`, `revises`),
the status PATCH, photo-sign/upload validation, and the offline-queue
wrappers all already exist. Verify each claim below against the code —
do not take this prompt's word for it.

---

## §1 Read before you touch anything

1. `v2/api/app/routers/projects.py` — `create_project` (~50),
   `patch_project` (~94, `authorize("adviser")`), `instantiate_checklists`
   (~214), `patch_item` (~295). `ChecklistItemPatch` (~289) is the model
   you'll extend.
2. `v2/api/app/routers/daily.py` — photo validation inside `create_entry`
   (~93–103) is the reuse pattern for photo edits; `_editable` (~142) is
   the permission template.
3. `v2/api/app/routers/documents.py` — `advance_step` (~410),
   `request_revision` (~451) — study the round semantics before touching
   re-sign. `RESOLVED` = signed/skipped/revision_requested.
4. `v2/api/app/models.py` — `ProjectChecklistItem` (~169), `JournalPhoto`
   (~136), `DocumentSignatoryStep` + `round_no`/`revises` (~237),
   `DocumentRevision` (~253).
5. `v2/web/src/pages/Projects.jsx` — create sheet: `ChecklistPreview` is
   read-only (~136); `PATCH` isn't imported — status control is absent.
6. `v2/web/src/pages/ProjectDetail.jsx` — checklist rows (~157–197): the
   `max-w-[8.5rem]` select is the crushing offender; `unassigned` raw
   option (~181).
7. `v2/web/src/components/ChainFlow.jsx` — `StepCard` (~36) renders
   actions only on `pending` steps (~78–90).
8. `v2/web/src/pages/Journal.jsx` — edit sheet hides PhotoPicker with the
   "can't be changed" note (~185–189); card footer wraps badly
   (~161–175).
9. `v2/web/src/pages/DocumentDetail.jsx` — revision sheet + `openRevision`
   (~158), movement edit note (~390). Mobile mirrors at
   `v2/mobile/app/(tabs)/document/[id].jsx`, `journal.jsx`,
   `projects.jsx`, `project/[id].jsx`, `src/components/ChainFlow.jsx`,
   `src/components/ChecklistPreview.jsx`.
10. `v2/mobile/src/lib/offline.js` — `submitPhotoRecord`, `isQueued`,
    `queuedMsg`: mutations on mobile already route through the offline
    queue — keep new writes consistent with that pattern.
11. `v2/api/tests/test_daily_edits.py` — fixture/style for new tests
    (sqlite + `@compiles(JSONB)` pattern, direct handler invocation).
12. `AGENTS.md` UX rules — plain language, never a silent no-op, every
    destructive confirm names its consequence, preview-before-commit.

## The footguns — learn from what already bit us

- **Tri-state fields.** `PATCH` bodies distinguish "absent" (leave alone),
  "null" (clear), "value" (set) via `body.model_fields_set` — see
  `project_id` in `patch_entry` and `note` in `patch_movement`. Every new
  nullable field you add must follow this or clearing becomes impossible.
- **`exclude_none=True` is a footgun.** `patch_project` applies
  `model_dump(exclude_none=True)` — a `None` can't reach the DB. That's
  fine for `status` but don't extend that pattern to new tri-state fields.
- **Revisions are append-only history.** `signed`/`skipped`/`superseded`/
  `revision_requested` rows are never deleted or reverted — new rounds
  are *new rows* with `round_no+1` and `revises=orig.id`. Preserve that
  invariant; "re-sign" means clone-as-pending, not un-sign.
- **The pending-drop trap.** `request_revision` sets every `pending` step
  to `superseded`, then recreates only `resends + at_step`. A mid-route
  revision today silently deletes the rest of the route — your fix must
  make carry-over explicit (the officer sees the new round before
  committing).
- **Mobile writes go through the offline queue.** `submitPhotoRecord`
  wraps sign→upload→POST with `{{photo_path}}` templating, and mutations
  surface `isQueued`/`queuedMsg` toasts ("Saved on this device…"). New
  mobile mutations reuse the existing helpers — don't build parallel
  offline plumbing, and don't break the queue's API shape.
- **Photo validation is server-side truth.** sign → PUT → then the record
  POST validates org-scoped path + `object_head` + magic bytes
  (`create_entry` ~93–103). Photo-edit endpoints must run the same three
  checks on `add_photos`/`photo_path` — no trusting the client.
- **RN image uploads use `expo-file-system`'s `uploadAsync`**, not
  `fetch(uri).blob()` — the journal/movement/avatar paths already share
  `putToSignedUrl`; reuse it for edit-flow uploads.
- **`model_fields_set` powers every "clearable" field.** Already listed —
  it bites twice: `ProjectIn.flags` default `{}` would wipe flags on
  PATCH, which is why `ProjectPatch.flags` is `| None`. Mirror that care.

---

## §2 Hard constraints — violations are regressions

- **Additive-only API.** New endpoints + new optional fields on existing
  PATCH/POST bodies. No response shape changes, no removed fields, no
  auth-model changes. `authorize()` stays the enforcement point.
- **Checklist structural edits**: `adviser+` **or the project's lead**
  (`project.owner_id == member.user_id`). Done-toggle and self-assign keep
  their existing `officer+` rules — don't tighten them.
- **Status transitions**: `adviser+` unrestricted; the **project lead may
  set `status` and only `status`** — a lead PATCH touching any other
  field gets 403. Any direction allowed (done → active is legal).
- **Re-sign semantics**: history rows immutable; new round = clones;
  every step of the old current round ends up exactly one of: carried
  into the new round, resolved-final (signed/skipped stays), or
  explicitly superseded **by officer choice in the sheet** — never by
  silence.
- **Storage cleanup best-effort** after commit; a storage failure never
  blocks the mutation.
- **Audit rows** for privileged/late actions, following existing names:
  `checklist_item.added/.edited/.deleted`, `checklist.reordered`,
  `journal.edited_post_day` (already exists — reuse), movement edits
  already audit; add `document.revision_requested` metadata for the new
  trigger type.
- **Both clients ship the same affordances** — parity is the point.
- **Design language stays brutalist** — tokens only, no hardcoded hex;
  ≥36px targets everywhere, ≥44px for primary actions; every change
  readable in all four themes.
- **Plain JS/JSX, existing deps only.** No secrets, no tool attribution,
  no comments unless the file's style already has them.

---

## §3 Work packages

Order: API (WP1–WP3) first, then web + mobile UIs per package, tests last.
UI for a feature may not land before its API.

### WP1 — Checklist item CRUD (`v2/api/app/routers/projects.py`)

- `POST /orgs/{org}/projects/{pid}/checklist-items` (201) — body
  `{label (min 1), hint?, required?, due_date?}` → appended at
  `max(ord)+1`, `template_id=None`. Permission: adviser+ or project lead.
  Audit `checklist_item.added`.
- Extend `ChecklistItemPatch` with `label`, `hint` (tri-state),
  `required`, `due_date` (tri-state: null clears), `ord`. Guard: if any
  structural field is present, require adviser+/lead; a body with only
  `done`/`assignee_id` keeps the current permission path. Audit
  `checklist_item.edited`.
- `DELETE /orgs/{org}/checklist-items/{item_id}` — adviser+/lead. Audit
  `checklist_item.deleted` (metadata: `label`, `done`, `assignee_id`).
- `POST /orgs/{org}/projects/{pid}/checklist-items/reorder` — body
  `{item_ids: [uuid…]}` must be **exactly** the project's item id set
  (422 otherwise); assigns `ord` = list position. Adviser+/lead. Audit
  `checklist.reordered`.
- `ProjectIn` gains `checklist_items: list[ItemSeed] | None` —
  `ItemSeed {label, hint?, required?, due_date?}` (cap ~100, label min 1).
  When provided, write the rows verbatim at create (`ord` = array index,
  `template_id=None`); when absent, behavior is unchanged (detail page
  still auto-generates or shows the empty state).
- Factor the permission check into one helper
  (`_structural_ok(project, member)` → adviser+ or `owner_id == user`).

### WP2 — Photo editing (`v2/api/app/routers/daily.py`, `documents.py`)

- `EntryPatch` gains `add_photos: list[dict] | None` and
  `remove_photo_ids: list[uuid.UUID] | None` (same `_editable` gate):
  - `add_photos`: run the create-path validation per item (org-scoped
    `storage_path`, `object_head`, `check_magic_bytes`) → insert
    `JournalPhoto` rows.
  - `remove_photo_ids`: every id must belong to this entry (422
    `BAD_PATH` otherwise); delete rows; after commit, best-effort
    `storage.delete_object` each.
  - Owner post-day photo change → `journal.edited_post_day` audit with
    `photos_added`/`photos_removed` counts in metadata.
- `MovementPatch` gains `photo_path: str | None` (org-scoped +
  `object_head` validated) and `clear_photo: bool | None`. Replace or
  clear → after commit, best-effort delete of the **old** path.
  `photo_path` + `clear_photo` together = 422.

### WP3 — Revisions: return-to-step (`v2/api/app/routers/documents.py`)

- `RevisionIn` gains `return_to_step_id: uuid.UUID | None`.
- `resend_step_ids` now accepts **any step of the document** — resolved
  steps are re-signs, **pending** steps are carries (they clone into the
  new round instead of superseding).
- Trigger is exactly one of: `at_step_id` (pending — existing),
  `return_to_step_id` (resolved — new), or neither (existing late
  revision on `signed`/`filed`). Two triggers together → 422.
  `return_to_step_id` on a step that isn't resolved/current-doc →
  409 `STEP_CLOSED`-style error; on a doc with no resolved steps → the
  "at least one step" validation already covers it.
- `return_to` semantics: the step becomes `revision_requested` (+note,
  `noted_by`), and clones **pending** into the new round — same as
  `at_step` but starting from a resolved step.
- New round = clones of {trigger step} ∪ resend ids, `ord` preserved,
  `revises=orig.id`, `round_no+1`. All other pendings → `superseded`
  (the UI makes this an explicit choice — see WP6).
- Doc status → `revision`; round completes → `signed` (existing logic
  already handles this via current-round pending check).
- Audit metadata records which trigger fired.

### WP4 — Create-form checklist editor (web `Projects.jsx` + mobile `projects.jsx`)

- New component per app: `ChecklistEditor` (lives next to
  `ChecklistPreview`; the read-only preview stays for the detail page).
- Section 1 — "Start from templates": every org template rendered as a
  checkable row (`name · track · event_type · N items`); rows matching
  the current needs/event_type/flags are **pre-checked** (reuse the
  matching logic in `src/lib/rules` / `ChecklistPreview`). Templates are
  a starting point, not a gate — any subset is legal, including none.
- Section 2 — the merged item list, **editable**: per-row rename input,
  remove button, up/down reorder, "+ Add item" row. Item order shown =
  submission order. Due dates computed by the instantiation rules stay
  visible but aren't editable here (post-create editing covers that).
- Submit: `POST /projects` with `checklist_items` (position = ord).
  `needs_paper_processing`/`needs_logistics` still submit — they're
  defaults for template pre-check and card chips, not gates.
- Mobile: same component, `CheckRow`/`Input`/`Button` primitives, works
  inside the Sheet's scroll view.

### WP5 — Detail-page checklist editing + filters (web `ProjectDetail.jsx` + mobile `project/[id].jsx`)

- **Filter chip row** above the items: `All / Open / Done / Mine /
  Unassigned` with counts; client-side; default All. Below it a compact
  summary line is allowed ("3 of 8 done").
- **Structural affordances** (visible to adviser+/lead only): per-row
  edit (sheet: label, hint, due date, required toggle → PATCH), delete
  (ConfirmDialog: "Removes it from the checklist — its done state and
  assignee go with it."), up/down reorder controls, "+ Add item" → same
  sheet.
- Untouched: done-toggle (officer+), assign select, Take-it button.
- While items exist, keep the force-pick/generate affordance available
  to adviser+/lead as "add more from a template" (instantiate append).

### WP6 — Re-sign UI (web `DocumentDetail.jsx`/`ChainFlow.jsx` + mobile mirrors)

- `ChainFlow` step cards: `canWrite` && step is in the **current round**
  gets a "Send back" affordance — pending steps keep the existing
  button; **resolved** steps (signed/skipped) get a subtle ghost
  `Undo2` "Send back". Opens the revision sheet either way.
- Revision sheet (extend existing): when triggered from resolved step K,
  the resend checklist pre-checks **K plus every step ordered after it**
  (the natural "goes back to that desk" default); officer unchecks freely.
- The sheet's bottom preview names the new round verbatim: "New round:
  SSC President → SAS routing → School Director" — and, when pendings are
  left unchecked, an honest warning: "N steps won't carry over — they'll
  be marked superseded." (AGENTS.md preview-before-commit.)
- Late revision on `signed`/`filed` docs unchanged.
- Mobile `ChainFlow.jsx` + `document/[id].jsx` get the same affordances.

### WP7 — Status transitions + density + casing (all clients)

**Status control**
- `patch_project` guard: adviser+ → anything; non-adviser who is
  `p.owner_id` → only if `set(body.model_fields_set) <= {"status"}`,
  else 403.
- Detail header (web + mobile): permitted roles get a "Change status"
  control (Select/sheet, 4 options, one-line consequence each); `done`
  and `archived` go through a ConfirmDialog first. Board cards may show
  the control to permitted roles — detail header is the required surface.

**Density (web ≤480px + mobile parity)**
- `Journal.jsx` card footer → `flex-wrap`; chip left, actions right,
  actions wrap under the chip on narrow; description never truncates.
  Mobile `journal.jsx`: verify the same wrap.
- `ProjectDetail.jsx` checklist row → allow wrap: line 1 =
  checkbox + label (`min-w-0`, `break-words`), meta row below =
  due chip + assign control (select gets `min-w-[10rem]`, may grow).
  Mobile rows already stack — verify no squeeze.
- `ChainFlow` StepCard: title/chip header wraps (chip below title on
  <380px), action row `flex-wrap`, buttons ≥36px. Movement rows: actions
  may wrap under the timestamp.
- No control row may clip or overflow horizontally at 360px.

**Casing**
- New `src/lib/labels.js` per app: `statusLabel` maps for
  project/document/step/attendance/member/task statuses
  (`draft`→"Draft", `concept_paper`→"Concept paper", `routing`→"Routing",
  `declared_no_tasks`→"No tasks", `unassigned`→"Unassigned"),
  plus `enumLabel` generic (`s.replaceAll('_',' ')`, first-letter cap).
- Sweep both apps: every raw enum rendered to users goes through the
  map — chips, select options, group headers, empty states
  (`not recorded yet` → "Not recorded yet"). Prose copy
  ("who signs, in order") stays as designed — only enum echoes change.

### WP8 — Tests + docs

- `v2/api/tests/test_ux_edits.py` (new, sqlite + `JSONB` compiles pattern
  from `test_daily_edits.py`): checklist CRUD permission matrix
  (lead yes / adviser yes / officer no), reorder set-validation,
  create-with-`checklist_items`, photo add/remove incl. bad-path +
  cleanup-called, movement photo replace/clear, revision
  `return_to_step_id` + pending-carry invariant (new round contains
  trigger + chosen carries; excluded pendings superseded),
  status-by-lead ({status} ok, {title} → 403), late revision unchanged.
- `smoke_e2e.py`: add item → rename → reorder → delete; status
  draft→active; edit entry adding a photo; send-back-from-signed-step
  round trip.
- `spec.md` §5 table: new endpoints; §6 notes. `USER_GUIDE.md`: one
  plain-language line each for checklist editing, photo fixes,
  re-signing, status moves. No migration needed — all additive.

---

## §4 Acceptance criteria — the pass/fail list

- [ ] At 360px width, no row on Journal / Projects / ProjectDetail /
      DocumentDetail clips, overlaps, or forces horizontal scroll.
- [ ] A project can be created with a checklist picked+edited in the form
      (items arrive verbatim, ord preserved), including **zero** items.
- [ ] Checklist items can be added, renamed, due-dated, required-toggled,
      reordered, and deleted by the project lead and adviser+; officers
      get 403 on structure but keep done/self-assign.
- [ ] Journal photos can be added and removed on an existing entry;
      movement photos can be replaced and cleared; removed objects are
      deleted from storage (best-effort).
- [ ] Checklist filters work and counts are right.
- [ ] `unassigned` → "Unassigned", `concept_paper` → "Concept paper",
      `draft` → "Draft" — a grep for rendered raw enums finds none.
- [ ] From a signed step mid-route, "Send back" opens the revision sheet
      with K+later steps pre-checked; submitting produces a new pending
      round containing exactly the chosen steps; steps before K keep
      their signed records; doc returns to `signed` when the new round
      resolves.
- [ ] Lead and adviser+ can move a project through any status order,
      with confirms on done/archived; a lead PATCH on non-status fields
      is 403.
- [ ] `pytest` green incl. new file; `npm run build` green;
      `npx expo lint` clean; `npx expo export --platform android`
      bundles clean; `git diff v2/api` is additive-only on existing
      lines.

---

## §5 Verification sequence

1. `cd v2/api && .venv/Scripts/python -m pytest -q` — all green.
2. `cd v2/web && npm run build` — green. Dev-tools at 390px: exercise
   journal card, checklist rows + filters + edit, ChainFlow send-back,
   status change.
3. `cd v2/mobile && npx expo lint && npx expo export --platform android`
   — clean.
4. Real device (Expo Go or the preview APK): journal photo edit end-to-end;
   checklist edit as lead; send-back from a signed step; status move.
5. `git diff v2/api` — additions only on existing lines.

---

## §6 Out of scope

Push/email notifications for revisions or status changes; checklist
*template* editing (exists already); per-item reorder drag-and-drop
(up/down is fine); undo; version history on checklist items; syncing a
template edit into already-instantiated project items (snapshots stay
snapshots); doc-type chaining; anything in `v2/landing/`; new offline
queue plumbing beyond reusing the existing helpers. Note deliberately
deferred ideas in "future polish" — don't sneak them in.

## Output format

1. Ordered list of files changed/created with a one-line "why" each.
2. WP landing order and why.
3. New-endpoint table: method, path, permission, side-effects, audit.
4. Before/after of `request_revision`'s pending-handling.
5. Verification output: pytest tail, web build tail, expo lint/export tails,
   manual 390px + device notes.
6. Deviations from this prompt, each with the reason.
7. "Future polish" — deliberately deferred items.
