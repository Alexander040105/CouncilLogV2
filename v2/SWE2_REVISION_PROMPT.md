# SWE-2 High Prompt — CounciLog: Paper revision & re-sign cycles

You are a senior product engineer. CounciLog's Papers logbook tracks a
document's **custody** (who physically holds it) and its **signatory chain**
(an ordered snapshot of steps: `pending → signed/skipped`). Both flows work —
but they are **one-way**. In real student-council life a document gets sent
back: the School Director requests a change on page 3, and the paper must be
**re-signed by the offices before her** (Dean → SSC President → SAS) before
returning to her desk. Today there is no way to express that — once a step is
resolved it is `STEP_CLOSED` forever, and once every step is resolved the
document is `signed` forever.

Your mission: add **revision rounds** to the papers logbook. A signatory can
send the document back for revision with a required note; the recording
officer picks **which prior signatories must re-sign** (real cases vary —
sometimes all of them, sometimes one); each revision appends a **new round of
step rows** so the logbook preserves every signature ever made; and a bulk
"sign all pending" action covers the fast case where everyone re-signs the
same day. Revisions are also allowed on **fully-signed documents** (a
late-stage change reopens the chain into a new round).

This requires **API + migration + web** work. Work at the repo root
(`CouncilLogV2/`). App code lives in `v2/web/` + `v2/api/` +
`v2/supabase/migrations/`.

---

## §1 Read before you touch anything

1. `v2/PRODUCT.md` — audience and tone (Operate-mode tool for student
   officers on phones; plain language over jargon).
2. `v2/DESIGN.md` — tokens, primitives, four-variant theme system. Source of
   truth for styling.
3. `v2/spec.md` — §3 features, §4 data model, §5 API inventory, §8 security.
4. `v2/USER_GUIDE.md` — the papers workflow you'll extend.
5. `COUNCIL_HANDBOOK_V2.md` — the real signatory culture this models
   (Dean → SSC President → SAS → School Director chains; documents returned
   for revision; fast same-day re-signing).
6. `v2/api/app/routers/documents.py` — all of it. The pieces you build on:
   - `DocumentSignatoryStep` rows are **instantiated snapshots** of a
     `SignatoryChain`'s steps at document-creation time
     (`instantiate.instantiate_chain`).
   - `advance_step` (`POST .../steps/{step_id}`) moves `pending → signed|
     skipped`, guards on `STEP_CLOSED`, and flips `documents.status` to
     `signed` when **no pending steps remain**.
   - **Signing is NOT sequential today** — any pending step may be resolved
     in any order. Do not introduce ordering; revision design must tolerate
     pending steps existing "above" the requester's step (see §3 WP2).
   - `DocumentMovement` is the separate custody log — revision work does not
     change it.
7. `v2/api/app/models.py` — `Document`, `DocumentMovement`,
   `SignatoryChain`, `SignatoryStep`, `DocumentSignatoryStep`.
8. `v2/api/app/services/instantiate.py`, `services/audit.py`, `deps.py`
   (`authorize("officer")` — this app records signatures on behalf of
   offices; there is no per-office auth), `errors.py`, `pagination.py`.
9. `v2/web/src/pages/DocumentDetail.jsx` — the logbook UI (signatory steps
   list, Sign/Skip actions, skip sheet, custody timeline, Move paper).
10. `v2/web/src/pages/Documents.jsx` — list + register sheet + chain preview.
11. `v2/web/src/lib/rules.js` — client mirror of the match rules (leave
    alone; revision is not a match-time concern).
12. `v2/supabase/migrations/0001_init.sql` — FK graph + RLS policy style.
    Highest existing migration number is `0003`; yours is `0004`.
13. If the `impeccable` skill is installed: run
    `impeccable context --target v2/web` once at session start, and read
    `reference/craft-floor.md` before your first UI edit. If not installed,
    skip silently.

---

## §2 Hard constraints — violations are regressions

- **Plain JavaScript/JSX.** No TypeScript anywhere.
- **No new dependencies.** Everything needed exists already.
- **Token-driven styling.** `var(--*)` only — no literal hex, no `bg-white`.
  All four theme variants (brutalist-light default, brutalist-dark,
  classic dark, classic light) must pass WCAG AA; ≥44px touch targets;
  usable at 360px. Reuse `.label-strong` / `.heading-strong` and the
  `Chip`/`Sheet`/`Field`/`Button` primitives.
- **Append-only history.** Never mutate or delete a resolved step row to
  express a re-sign — revisions append new rows. The only permitted
  mutations on an existing step are the round-1 status transition
  `pending → revision_requested` and `pending → superseded` (§3 WP2).
- **Thin client.** All reads/writes through FastAPI; no direct table access
  from the web app.
- **Authz stays `officer`.** Same role gate as sign/skip/movements. Do not
  add per-office verification — that's a future product decision, not this
  one.
- **Plain language in UI.** Prefer "Send back for revision" / "Re-sign" over
  institutional jargon; `note` fields say *why*, always.
- **No secrets, no AI/tool attribution** (per repo `AGENTS.md`).
- **Don't regress:** the `revision` doc status must not break the Documents
  list filter, project-linked document strips, or existing pending→signed
  behavior when no revision has ever been requested.

---

## §3 Work packages

### WP1 — Migration `v2/supabase/migrations/0004_document_revisions.sql`

1. `document_signatory_steps` gains:
   - `round_no integer not null default 1`
   - `revises uuid null references document_signatory_steps(id)` — points at
     the step instance this row re-signs
2. New table `document_revisions` — one row per revision request:
   `id uuid pk`, `org_id`, `document_id` (FKs matching existing style),
   `requested_at_step_id uuid null references document_signatory_steps(id)`
   (null for late revisions on a signed doc), `round_no integer not null`,
   `note text not null`, `created_by uuid references profiles(id)`,
   `created_at timestamptz default now()`. Mirror the RLS policies used on
   `document_signatory_steps`/`document_movements` (same org-scoped pattern).
3. `models.py`: `DocumentRevision` table class; add `round_no`/`revises`
   fields to `DocumentSignatoryStep`. `documents.status` gains the value
   `revision` (transition map below) — update any check constraint or
   doc comment.
4. Status vocabulary (steps): `pending`, `signed`, `skipped`,
   `revision_requested`, `superseded`. Doc: `drafting`, `routing`,
   `revision`, `signed`.

### WP2 — API (`routers/documents.py`)

1. **`POST /orgs/{o}/documents/{d}/revisions`** — body
   `{at_step_id?: uuid, note: str(1..500, required), resend_step_ids: [uuid]}`
   — `authorize("officer")`. Semantics:
   - Doc must exist in-org and have ≥1 signatory step; `drafting` docs (no
     chain) → `409` "nothing to revise".
   - `note` required → `422 NOTE_REQUIRED` otherwise. The note is the
     revision reason ("revise page 3 budget table") — it shows in the log.
   - **Mid-route revision** (`at_step_id` present): the step must belong to
     this doc and be `pending` → set `status='revision_requested'`, `note`,
     `noted_by`. (`signed`/`skipped` steps can't be the requester — the
     paper bounces at the desk that's currently holding it.)
   - **Late revision** (`at_step_id` null): only when `doc.status == 'signed'`
     — the whole chain is resolved, so there's no pending step to mark.
     If doc isn't signed and no `at_step_id` → `422 AT_STEP_REQUIRED`.
   - `resend_step_ids`: every id must belong to this doc **and be resolved**
     (`signed`/`skipped`/`revision_requested`) — pending steps are already
     open and must not be duplicated; violating ids → `422 NOT_RESOLVED`.
     Empty list is legal ONLY if `at_step_id` is present (revision bounces
     straight back to the requester after edits); empty + late revision →
     `422 RESEND_REQUIRED` (a late revision with nobody re-signing is a
     no-op).
   - Compute `round = max(round_no over the doc's steps) + 1`. Insert a
     `DocumentRevision` row. Then:
     a. **Supersede stale pendings** — any step with `status='pending'` in
        rounds < `round` (excluding `at_step_id`, already marked) becomes
        `superseded`. Because signing isn't sequential, a revision can start
        while other desks still hold open steps; those rows are dead wood —
        the new round is the live route.
     b. **Append round-N rows** — for each `resend_step_id`, insert a new
        `DocumentSignatoryStep` (same `ord`/`label`/`office`,
        `status='pending'`, `round_no=round`, `revises=<original step id>`).
     c. **Requester re-queues** — on a mid-route revision, also append a
        fresh `pending` copy of the requester's own step in the new round
        (`revises=at_step_id`) so the paper returns to their desk last.
        (Ordering by `ord` naturally keeps it last when they were the
        highest pending step; display sorts by `(round_no, ord)`.)
   - `doc.status = 'revision'`. Audit `document.revision_requested` with
     `metadata={round, at_step, resend: [...], note}`. Return
     `{data: revision_row, new_steps: [...]}`.
2. **`POST /orgs/{o}/documents/{d}/steps/sign-all`** — `{step_ids?: [uuid]}`
   — officer+. Signs every step that is `pending` in the doc's **current
   (max) round**; `step_ids`, when given, must be a subset of that set
   (else `409`). Sets `signed`/`signed_at`/`noted_by` on each; a shared
   optional `note` applies to all. This is the "everyone re-signed today"
   fast path. Audit `signatory.bulk_signed` with the step list.
3. **`advance_step` — rescope completion to the latest round.** Today it
   flips `doc.status='signed'` when zero steps are pending **anywhere**.
   Change the check to: zero `pending` steps where
   `round_no = max(round_no)` for the doc. (`revision_requested` and
   `superseded` rows are historical — they never block completion. Older
   rounds have no pending rows after superseding anyway; the max-round
   scope just makes that explicit and safe.)
4. **`GET /documents/{id}`** response gains `revisions` (the
   `document_revisions` rows, chronological) and `current_round`
   (max `round_no`). Steps already come back ordered — make ordering
   `(round_no, ord)`.
5. Errors via `APIError` envelope; audit every state change; commit once
   per request.

### WP3 — Web: `DocumentDetail.jsx` logbook UI

1. **"Send back for revision"** — third action on every `pending` step row
   (ghost button next to Sign/Skip). Opens a `Sheet`:
   - Required `Field` "What needs changing?" (`Input`/`textarea`,
     placeholder "revise page 3 — budget table"), explaining this becomes
     the note in the log.
   - Checkbox list of the doc's **resolved** steps (`label + office`),
     default **all checked**, so the officer picks exactly who must
     re-sign — spec text: "Re-sign needed from:".
   - Summary line mirroring the outcome: "The paper re-routes through the
     checked offices, then returns to *{this step's label}*."
   - Submit → `POST .../revisions` → toast ("Sent back for revision") →
     invalidate `['document', org, id]`.
2. **Late revision** — when `doc.status === 'signed'`, the doc header shows
   a "Send back for revision" secondary button; same sheet but with
   `at_step_id` omitted and every step selectable.
3. **Round grouping** — the signatory card renders steps grouped by
   `round_no` (`(round_no, ord)` order): "Round 1", "Round 2 — revision",
   etc. Between rounds, insert the matching revision banner from
   `revisions[]`: "**Returned for revision** — {note}" + when/who
   (`created_by` → display name via the members query if cheaply available,
   else omit name). Resolved steps keep their strike-through + chip;
   `revision_requested` chips with kind `alert`, `superseded` chips with
   `skip`.
4. **Fast path** — when ≥2 steps are pending in the current round, a
   "Sign all pending" `Button` sits above the round's step list;
   `ConfirmDialog` ("Mark N steps as signed by their offices?") →
   `POST .../steps/sign-all` → toast.
5. **Status chips** — map `doc.status==='revision'` to a `pending`-style
   chip labeled "in revision"; `revision_requested` step → `alert` chip
   "sent back"; `superseded` → `skip` chip "superseded".
6. **Documents list** (`Documents.jsx`) — the existing status `Chip` already
   renders any status; make sure `revision` gets the pending-ish treatment,
   and confirm `?status=revision` filtering works via the existing
   `status` query param.

### WP4 — Tests

Extend `v2/api/tests/` (follow existing pytest style in `test_authz.py` /
`test_profile.py`; smoke additions per `smoke_e2e.py` conventions):

- Revision on a pending step without `note` → `422`; with note + two
  resend ids → that step is `revision_requested`, two new `pending` rows
  exist with `round_no=2` and `revises` set, requester's copy queued, doc
  `revision`.
- Revision while an unrelated earlier step is still `pending` → it becomes
  `superseded` and does not block completion.
- Resending a `pending` step id → `422 NOT_RESOLVED`.
- Late revision on a `signed` doc (no `at_step_id`) → works; on a `routing`
  doc without `at_step_id` → `422`.
- Completing all round-2 steps → doc `signed`; round-1 history intact
  (signed rows still `signed`, requester's row still `revision_requested`).
- `sign-all` signs only current-round pending; a stale-round id → `409`.
- `advance_step` on a `revision_requested`/`superseded` row → `409`
  (they're closed like any resolved step — confirm `STEP_CLOSED` covers
  them; if it only checks `!= 'pending'` it already does — assert it).

### WP5 — Docs sync

- `v2/spec.md`: §4 gains `document_revisions` + the two new step columns;
  §5 gains the two endpoints; note step-status vocabulary and doc status
  transitions.
- `v2/USER_GUIDE.md`: papers workflow gains the revision playbook ("SD sent
  it back — what do I tap"), including the fast path.
- `v2/DESIGN.md`: the "Paper logbook" paragraph gains one short block —
  round grouping + revision banner as the logbook's way of showing
  sent-back papers.
- `v2/ROLES.md`: no change expected (same officer gate) — verify, don't
  assume.

---

## §4 Acceptance criteria — the pass/fail list

- [ ] `cd v2/web && npm run build` passes; `pytest` passes (or smoke
      additions present + flagged "requires running stack").
- [ ] No `.ts`/`.tsx`; no new deps; no literal hex in components.
- [ ] Mid-route revision: requester's step → `revision_requested` + note;
      selected resolved steps re-open as round-2 pending rows with
      `revises` set; stale pending steps → `superseded`; doc → `revision`.
- [ ] Late revision on a signed doc reopens a selectable subset into a new
      round; doc returns to `revision`, then `signed` when round 2 resolves.
- [ ] History is never overwritten — every prior `signed`/`skipped` row is
      untouched; the logbook shows all rounds.
- [ ] `note` required on revision; resend ids must be resolved steps of
      this doc; empty resend + late revision → `422`.
- [ ] "Sign all pending" bulk-signs current-round steps only, confirmed by
      dialog, audited.
- [ ] UI at 360px and 1280px, all four themes: revision sheet usable
      one-handed, round grouping legible, chips carry label+icon (never
      color-only).
- [ ] Docs synced per WP5; no secrets, no tool attribution.

---

## §5 Verification sequence

1. `npm run build` (web) — must pass before claiming done.
2. `pytest` + `smoke_e2e` (if live stack) — report tails.
3. Manual smoke: register a doc on a chain, sign step 1, request revision
   at step 3 with two resends → verify round grouping + banner in UI;
   re-sign via "Sign all pending" → SD step → doc flips `signed`; then a
   late revision on the signed doc.
4. If `impeccable` installed: `impeccable detect --json` on changed files;
   fix real findings, skip stylistic noise contradicting §2.

---

## §6 Out of scope

Per-office authentication (officers record on behalf of offices — same as
today), sequential/enforced signing order, editing a chain mid-flight
(add/remove desks on a live document), document versioning/file uploads of
the paper itself, notifications/emails to signatories, revision counters in
the documents list beyond the status chip.

## Output format

1. Ordered list of files changed/created with a one-line "why" each.
2. Build + test output tails.
3. The §4 checklist with actual pass/fail results.
4. Any deviation from §3 (and why).
5. Short future-polish notes.
