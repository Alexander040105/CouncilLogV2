# SWE-2 Max Prompt — CounciLog: daily-record edits + mobile error fixes

You are a senior product engineer. The CounciLog ecosystem is live: FastAPI
(`v2/api`), React+Vite web (`v2/web`), Expo app (`v2/mobile`), static
landing (`v2/landing`). Real-device testing on Expo Go surfaced three bugs
and one UX gap, and a real product need emerged: **people log wrong things**
— typos in journal entries, a no-tasks declared by accident, a paper moved
to the wrong location — and today nothing can be corrected.

Your mission, in two parts:

1. **Fix the mobile errors.** Three logged errors and one confusing
   control, all diagnosed below — verify each against the code, don't take
   this prompt's word for it.
2. **Edit + delete on daily-loop records.** Journal entries, no-tasks
   declarations, and paper movements get correct/delete affordances on
   **both** clients. The API gets the missing endpoints (edit journal
   exists; everything else is new). Permissions mirror the existing
   `PATCH journal` rule: **author same-day, owner anytime.**

This is additive work — no endpoint contracts change shape. `v2/landing/`
is untouched.

---

## §1 Read before you touch anything

1. `v2/api/app/routers/daily.py` — the whole journal/attendance surface.
   `patch_entry` (line ~135) is your permission template; `_upsert_attendance`
   shows how journal writes drive `attendance_days`.
2. `v2/api/app/routers/documents.py` — `add_movement` (~227); movements are
   a custody log — "current location" is derived from the newest movement.
3. `v2/api/app/services/storage.py` — `delete_object` (101) exists; use it
   for photo cleanup, best-effort.
4. `v2/mobile/src/components/PhotoPicker.jsx` — `putToSignedUrl` (~109) is
   the broken upload path; `normalize` (~15) is where `fileSize` can die.
5. `v2/mobile/src/components/ui.jsx` — `Select` (~111) is the unreadable
   option sheet; `Sheet`/`ConfirmDialog` are already correct — reuse them.
6. `v2/mobile/app/(tabs)/_layout.jsx` — the extraneous-route warning lives
   in the last two `Tabs.Screen` entries.
7. `v2/web/src/pages/Journal.jsx` + `v2/web/src/pages/Attendance.jsx` +
   `v2/web/src/pages/DocumentDetail.jsx` — where the web edit/delete
   affordances land. Mirror their existing Sheet/ConfirmDialog patterns.
8. `AGENTS.md` UX rules — never a silent no-op; every destructive action
   names its consequence in the confirm dialog; plain language only.
9. `v2/api/tests/test_admin.py` — fixture/style pattern for the new test
   file; `v2/api/tests/smoke_e2e.py` for live-smoke additions.

## The footguns — learn from what already bit us

- **React Native blobs are fake blobs.** `fetch(file://...).blob()` → PUT
  is slow (base64 round-trip — RN logs a warning) *and* produces a body
  Supabase Storage rejects with 400. `expo-file-system`'s `uploadAsync`
  streams the file natively — it fixes both at once. `expo-file-system` is
  bundled in Expo Go; `npx expo install` it, never `npm install`.
- **`ImagePicker` assets can have `fileSize: null`.** The photo-sign
  endpoint validates `byte_size > 0` — a null size 400s before upload.
  Fall back to `FileSystem.getInfoAsync(uri).size`.
- **expo-router groups.** `(tabs)/_layout.jsx` `Tabs.Screen` entries must
  name routes that exist *inside `(tabs)/`*. `app/account.jsx` and
  `app/admin.jsx` live at root — declaring them in Tabs is what logs
  "Route X is extraneous". Root Stack needs no entries.
- **Attendance is a single row per member+day.** Status is `documented` or
  `declared_no_tasks` — journal writes upsert it. A delete must recompute:
  deleting someone's last entry of a day can't leave `documented` behind
  (they'd look compliant without proof).
- **Movements are an append-only-feeling log.** Deleting the newest one
  silently reverts "current location" to the previous movement — legal,
  but the UI must say so in the confirm. Deleting the *only* movement
  leaves the paper with no recorded location — also legal, also stated.
- **Select sheets must answer two questions instantly**: what are my
  options, and which one is on? The current version answers neither —
  faint tint and slightly-bolder text is not a selected state.

---

## §2 Hard constraints — violations are regressions

- **Additive-only API.** New endpoints + one optional field on
  `EntryPatch`. No existing response shape changes, no removed fields,
  no auth changes. `authorize()` stays the enforcement point.
- **Permission rule is fixed**: author/mover on their own record *same
  day* (`entry_date`/`created_at` day == `org_today()`), or `owner`
  anytime. Owner edits/deletes on past-day records write an audit row
  (`journal.edited_post_day` already exists — keep that pattern:
  `journal.deleted`, `attendance.retracted`, `document.movement_edited`,
  `document.movement_deleted`).
- **Storage cleanup is best-effort**, after the DB commit, wrapped so a
  storage failure never blocks the delete.
- **Plain JavaScript/JSX** (no TS), existing deps only + `expo-file-system`.
- **Both clients ship the same affordances** — parity is the whole point.
- **Confirm before delete, everywhere** — `ConfirmDialog` (web/mobile both
  have it), body text states the real consequence.
- **Brutalist select** — the redesign uses tokens only, keeps
  bordered-box language, works in all four themes. No hardcoded hex.
- **No secrets, no tool attribution, no comments unless existing style
  has them.**

---

## §3 Work packages

Each WP lands working software. Order matters: API first (clients depend
on it), mobile fixes can land in parallel, UIs last.

### WP1 — Mobile error fixes

1. `(tabs)/_layout.jsx`: delete `<Tabs.Screen name="account">` and
   `<Tabs.Screen name="admin">`. The warning must be gone; pushing
   `/account`/`/admin` from More still works via the root Stack.
2. `npx expo install expo-file-system`. Rewrite `putToSignedUrl` in
   `PhotoPicker.jsx` as `FileSystem.uploadAsync(signedUrl, photo.uri,
   { httpMethod: 'PUT', headers: { 'content-type': photo.type } })` —
   check `res.status` < 300, throw `Upload failed (${res.status})` else.
3. `normalize()`: when `asset.fileSize` is missing/0, resolve
   `FileSystem.getInfoAsync(uri).size` (make `add` async-safe — collect
   normalized assets with awaited size before `onChange`).
4. `account.jsx`: delete the inline `fetch(uri).blob()` block; use
   `putToSignedUrl` like journal/document do.
5. Verify by re-running a real photo upload on Expo Go — the blob warning
   and the 400 must both be gone.

### WP2 — Select option-sheet redesign (mobile)

`ui.jsx` `Select` — keep the trigger as-is; rebuild the option list:

- Every option renders as a **bordered box** (`t.boxWidth` border,
  `t.boxColor`, `t.radiusInput`, `minHeight: 44+`, `gap: 8` between rows,
  `surface2` fill) — rows read as buttons, not labels.
- **Selected row**: `t.accent` background, `t.accentFg` text, `shadow1`
  offset shadow via the existing `shadowBox` helper, `Check` icon
  (lucide) trailing — unmistakable in every theme.
- **Empty-value option** (`value === ''`): dimmed `ink3` text, and callers
  pass a real label — "No project", not "—". Update the journal project
  picker (and any other caller passing "—") accordingly.
- `accessibilityRole="radio"` + `accessibilityState={{ selected }}` per row.
- Sheet keeps title = field label; if the pick isn't obvious, a one-line
  `Currently: {label}` caption under the title is allowed.
- Long lists scroll — Sheet already scrolls, don't break it.

### WP3 — API endpoints (`v2/api`)

- `DELETE /orgs/{org}/journal/{entry_id}` — author same-day or owner.
  Collect the entry's `JournalPhoto` rows; delete rows + entry; recompute
  attendance: **if no journal entries remain for that member+day, delete
  the `AttendanceDay` row** (they become unaccounted and can re-declare);
  commit; then best-effort `storage.delete_object` per photo. Audit
  `journal.deleted` (metadata: `day`, `photos` count).
- `PATCH /orgs/{org}/journal/{id}` — extend `EntryPatch` with optional
  `project_id` (validate project exists + belongs to org, same as create).
- `DELETE /orgs/{org}/attendance/{day}` — retracts a `declared_no_tasks`
  row: own row same-day, or owner any member via `?member_id=`. **409
  `DOCUMENTED_DAY`** when the row's status is `documented` — the error
  message must say "delete the journal entry instead". Audit
  `attendance.retracted`.
- `PATCH /orgs/{org}/documents/{doc}/movements/{id}` — mover same-day or
  owner (floor `authorize("officer")`); edits `location_text` + `note`
  only — photo replace = delete + re-add (state that in docs).
- `DELETE` same path — same permission; delete row; best-effort
  `delete_object` for `photo_path` after commit; audit
  `document.movement_deleted`.

### WP4 — Web UI

- `Journal.jsx`: per-entry **Edit** (Sheet: description + project select,
  prefilled) + **Delete** (ConfirmDialog: "This day will show as
  unaccounted again unless another entry exists — you can re-file or
  declare no tasks.") — own same-day entries; owners on all entries.
- `Attendance.jsx`: on `declared_no_tasks` rows, a small **Retract**
  affordance (same permission shape; confirm explains they can re-declare
  or file an entry).
- `DocumentDetail.jsx`: per-movement **Edit** (location + note sheet) +
  **Delete** (confirm names the custody consequence: "The paper's current
  location becomes the previous movement" / "...becomes unknown").
- Visibility logic mirrors the server rule client-side (own same-day or
  owner) — server still enforces.

### WP5 — Mobile UI (same affordances)

- `journal.jsx`: Edit/Delete per entry (reuse Sheet/ConfirmDialog).
- `attendance.jsx`: retract on own same-day no-tasks rows.
- `document/[id].jsx`: Edit/Delete per movement in the timeline.
- Same dialogs, same copy (share the consequence strings conceptually —
  keep the wording identical between clients).

### WP6 — Tests + docs

- `v2/api/tests/test_daily_edits.py` (new): author same-day edit/delete OK;
  same-day delete cleans the AttendanceDay row; second surviving entry
  keeps `documented`; member-elsewhere delete/edit → 403; owner post-day
  delete OK + audits; attendance retract 409 on documented day + deletes
  declared row; movement edit/delete + photo cleanup called.
- `smoke_e2e.py`: extend the daily section — file entry, edit desc,
  delete entry, verify attendance flips back.
- `spec.md` §5 table rows for the 5 new endpoints; §6 note edit/delete
  affordances. `USER_GUIDE.md`: one line per playbook ("fat-fingered an
  entry? Edit or delete it same-day — owners can fix older ones").
- `PRODUCT.md`: no change needed (behaviors, not scope).

---

## §4 Acceptance criteria — the pass/fail list

- [ ] Expo Go logs are clean: no "extraneous route", no `Response.blob()`
      warning; a real photo journal upload succeeds end-to-end on the
      phone and renders on web.
- [ ] Select sheets show boxed options; the selected one is accent-filled
      with a check icon — visible in all four themes; `radio` a11y state.
- [ ] Journal entry can be edited (desc + project) and deleted on both
      clients; deleting the day's only entry un-documents the day.
- [ ] A no-tasks declaration can be retracted same-day (or by owner);
      documented days refuse with a helpful 409.
- [ ] A movement can be edited (location/note) and deleted; the timeline
      + current-location read correctly after each.
- [ ] Every delete shows a consequence-stating confirm; owner overrides
      audit-trail. A member touching someone else's record gets 403.
- [ ] `pytest` green incl. new file; `npm run build` green;
      `npx expo export --platform android` bundles clean; diff on
      `v2/api/` existing lines is additive-only.

---

## §5 Verification sequence

1. `cd v2/api && .venv/Scripts/python -m pytest -q` — all green.
2. `cd v2/web && npm run build` — green; manually exercise journal
   edit/delete, attendance retract, movement edit on localhost.
3. `cd v2/mobile && npx expo export --platform android` — bundles clean.
4. Expo Go on a real phone: sign in → journal a photo (no warnings, no
   400) → edit that entry → delete it → check the Select sheet for the
   project picker shows the new boxed options.
5. `git diff v2/api` — confirm every change is an addition (or the one
   optional `EntryPatch` field); no existing contract moved.

---

## §6 Out of scope

Editing/deleting projects, documents, checklist items, signatory steps,
members, or org settings (separate surfaces, separate rules); journal
*photo* add/remove inside the edit sheet (edit covers text + project —
photo changes = delete + re-file); undo/redo; entry history/versioning;
retracting `documented` via the attendance endpoint (409 by design);
pushing these buttons onto Guide/library surfaces. Note deliberately-
deferred ideas in a short "future polish" section — don't sneak them in.

## Output format

1. Ordered list of files changed/created with a one-line "why" each.
2. The WP landing order you used and why.
3. Before/after of `putToSignedUrl` and the Select sheet markup.
4. New-endpoint table: method, path, permission, side-effects, audit.
5. Verification output: pytest tail, web build tail, expo export tail,
   Expo-Go manual notes.
6. Deviations from this prompt, each with the reason.
7. "Future polish" — deliberately deferred items.
