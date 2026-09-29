# SWE-2 Max Prompt — CounciLog: offline-first mobile, tasks & notifications everywhere, and the visual paper trail

You are a senior product engineer. CounciLog's three platforms are live —
web on Vercel, the FastAPI backend, and the Expo mobile app — and the
workflow engine is finished (conditional chains, flag-gated templates,
checklist assignment emails). But three walls still stop real council work:

1. **The mobile app is a glass ornament without signal.** Every screen is
   one lost packet away from "Can't reach the server." Council members
   file journal entries from school hallways and log paper movements from
   offices with dead zones — the app must work *there*, queueing writes
   locally and syncing when connectivity returns.
2. **Assignment exists but has no surface.** You can assign a checklist
   item or a project lead and it emails — that's it. There's no way to
   hand someone a plain task ("draft the pubmat by Friday"), no in-app
   record that anything was assigned to you, and no push notification.
   Members find out they have work by remembering to open the app.
3. **The custody trail is a list, not a story.** A routed paper's detail
   page shows steps and movements as flat rows. Nobody can glance at it
   and see *where the paper is in its journey* — which desk it sits at,
   who held it, what the photo proof shows. The chain should render as
   what it physically is: a sequence of desks connected by arrows.

Your mission, in four parts:

1. **Offline-first mobile** — every mutation the app can make queues
   durably when offline and replays in order on reconnect; reads serve
   cached data. Losing signal mid-hallway must be a non-event.
2. **Tasks & notifications on all platforms** — a real `tasks` entity
   (assignable to any member, linkable to a project/document/journal
   entry), an in-app notification inbox with a bell on web and mobile,
   email on assignment, and push notifications on mobile.
3. **The visual paper trail** — document signatory chains render as
   process cards connected by arrows on web and mobile: each card is a
   desk showing status, holder, timestamps, and the photos logged at that
   step. Logging a movement with a photo lands on the current card.
4. **Improvements** — an open-ended audit-and-improve pass over the app,
   weighted toward how chains and workflows are visualized.

Work at the repo root (`CouncilLogV2/`). App code lives in `v2/web/` +
`v2/api/` + `v2/supabase/migrations/` + `v2/mobile/`.

---

## §1 Read before you touch anything

1. `v2/PRODUCT.md` — audience (student officers on phones, often with bad
   signal), plain-language voice, "org-shaped, not org-coded".
2. `v2/DESIGN.md` — tokens, primitives, theme system. Source of truth for
   styling on **both** clients.
3. `v2/spec.md` — §3 (features), §4 (data model), §5 (API inventory),
   §8.2 (cross-org isolation — mandatory on every new endpoint).
4. Repo-root `AGENTS.md` — plain language, never a silent no-op, preview
   before commit, empty states name cause + next step. The offline queued
   state is literally an invisible-behaviors rule: it must be visible.
5. `v2/mobile/src/lib/api.js` — the fetch wrapper every mobile request
   flows through. `ApiError` codes `NETWORK`, `TIMEOUT`, `ORG_LOADING`,
   `HTTP_*`. **This is the outbox interception point** — one generic queue,
   not per-feature plumbing.
6. `v2/mobile/src/lib/supabase.js`, `org.js`, `theme.jsx` — existing
   AsyncStorage patterns (session persistence deliberately uses
   AsyncStorage because SecureStore's 2KB limit can't hold a Supabase
   session — keep it, don't "fix" it).
7. `v2/mobile/app/_layout.jsx` — QueryClient setup, auth gate, theme
   provider. NetInfo wiring and notification listeners mount here.
8. `v2/mobile/src/components/PhotoPicker.jsx` — the signed-URL upload flow
   (`FileSystem.uploadAsync` to Supabase Storage). Offline photo support
   stages the file and defers this whole flow.
9. `v2/api/app/services/notify.py` — email infra to extend:
   `send_email` (aiosmtplib, config-gated no-op), `member_email` (Supabase
   admin API lookup), `notify_assignment` (called for project leads and
   checklist items — find both call sites in `routers/projects.py`).
10. `v2/api/app/routers/documents.py` — movements + steps machinery:
    `POST .../movements` accepts `location_text` + `photo_path`
    (org-prefix-validated). **Movements are flat today** — no link back to
    the step they happened at; WP1 adds `step_id` so the flow view can
    place a photo on the right card. Steps carry `status`
    (`pending|signed|skipped|revision_requested|superseded`), `round_no`,
    `revises`; revision loops live in `document_revisions` + step
    `round_no`.
11. `v2/api/app/routers/projects.py` — checklist item PATCH (assignee +
    notify call site), `InstantiateBody`, project `owner_id`.
12. `v2/api/app/models.py` — every table. New tables must match house
    style (SQLModel, `__tablename__`, `dict[str, Any] | None` for jsonb).
13. `v2/supabase/migrations/0001_init.sql` (FK style + RLS pattern) and
    `0004_document_revisions.sql` (comment-header style). Highest existing
    migration is `0009`; yours is `0010`.
14. `v2/web/src/pages/DocumentDetail.jsx` — the flow-viz target; already
    renders steps + movements lists.
    `v2/web/src/components/AppShell.jsx` — `NAV` + header for the Tasks
    nav item and the bell.
15. `v2/mobile/app/(tabs)/document/[id].jsx` — mobile flow-viz target;
    `app/(tabs)/_layout.jsx` for the bell/header;
    `app/(tabs)/more.jsx` for a Tasks entry point; `guide.jsx` — the
    mobile guide already exists and must gain the new sections.
16. `v2/mobile/app.json` + `eas.json` — `scheme: "councilog"` (deep links
    for notification taps), `extra.eas.projectId` already set,
    plugins array (the notifications config plugin goes here), preview
    profile builds the APK members install.
17. `v2/USER_GUIDE.md`, `v2/DEPLOY.md`, `v2/ROLES.md` — docs to sync.
18. `v2/api/tests/` (`test_instantiate.py`, `test_authz.py` conventions)
    and `smoke_e2e.py` — test patterns to extend.
19. **Skills** — if installed, use them; each exists on this machine:
    - `impeccable context --target v2/web` once at session start, and
      `reference/craft-floor.md` before your first UI edit. Repeat with
      `--target v2/mobile` before WP5/WP6 mobile UI — the skill has
      native-platform guidance.
    - `expo-data-fetching` — its `references/offline-and-cancellation.md`
      is the canonical NetInfo + `onlineManager` + React Query persistence
      pattern; follow it, don't improvise.
    - `expo-examples` — the `with-sqlite` example is the reference if you
      pick SQLite for the outbox.
    - `eas-app-stores` — push credentials (`eas credentials`) reference.
    - Expo docs are versioned: `docs.expo.dev/versions/v57.0.0/` — never
      `latest`, never your memory of a different SDK (mobile AGENTS.md).

---

## §2 Hard constraints — violations are regressions

- **Plain JavaScript/JSX.** No TypeScript, no `.ts`/`.tsx`, no type deps.
- **Web/API: no new dependencies.** `httpx` (already in the API) is the
  push transport; `aiosmtplib` is already there. **Mobile:** new deps only
  via `npx expo install`, and only from this whitelist:
  `@react-native-community/netinfo`, `expo-notifications`, `expo-device`,
  plus the WP3 storage pick (`expo-sqlite` **or**
  `@tanstack/react-query-persist-client`). Nothing else.
- **Token-driven styling.** `var(--*)` on web / the mobile theme object —
  no literal hex in components, no `bg-white`. All theme variants hold;
  ≥44px touch targets; usable at 360px. (`app.json` brand hexes are
  config, not components — matching them in the notifications plugin
  config is fine.)
- **The server is authoritative.** The outbox never lets the client
  invent permissions — a queued write that gets a 4xx on replay is a real
  rejection and lands in the dead-letter list, never silently dropped.
- **Snapshot semantics are sacred.** Editing/deleting templates and
  chains still never rewrites live checklists or routed papers. Queue
  replay doesn't change that.
- **No secrets committed.** SMTP and push stay config-gated no-ops in
  dev/test. The cron secret is an env var, not a literal.
- **No AI/tool attribution anywhere** (repo `AGENTS.md`).
- **Plain language.** "Saved on this phone — will send when you're back
  online", not "mutation enqueued". Every empty/error/queued state names
  the cause and the next step.
- **No hand-edited `ios/`/`android/`** — they don't exist; CNG. Configure
  via `app.json` plugins only.
- **Existing contract preserved.** Chains/templates editors, `409
  ALREADY_INSTANTIATED`, rule_json shapes, flag vocabulary — no
  regressions.

---

## §3 Work packages

### WP1 — Migration `v2/supabase/migrations/0010_tasks_notifications.sql`

New tables (match `0001` FK style + RLS pattern; `0004` comment-header
style):

1. `tasks` — `id` uuid pk, `org_id` → orgs cascade, `title` text not
   null, `description` text, `assignee_id` uuid (org member; null =
   unassigned), `creator_id` uuid not null, `due_date` date, `priority`
   text default `'normal'` (`low`/`normal`/`high`), `status` text default
   `'open'` (`open`/`done`/`cancelled`), `project_id` / `document_id` /
   `journal_entry_id` nullable FKs **`on delete set null`** — a linked
   entity going away must not take the task with it, `client_request_id`
   text, timestamps.
2. `task_comments` — `id`, `task_id` cascade, `author_id`, `body` text
   not null, `created_at`.
3. `notifications` — `id`, `org_id`, `user_id`, `kind` text, `payload`
   jsonb default `'{}'` (carries entity ids for click-through), `read_at`
   timestamptz null = unread, `created_at`. Index `(user_id, read_at)`.
4. `push_tokens` — `id`, `user_id`, `token` text unique, `platform` text
   (`android`/`ios`), `last_seen_at`, `created_at`.
5. `client_request_id` text nullable column added to `journal_entries`,
   `document_movements`, `documents`, `projects` — each gets
   `create unique index ... on (org_id, client_request_id) where
   client_request_id is not null`. Same on `tasks`.
6. `document_movements` gains `step_id` uuid nullable →
   `document_signatory_steps` `on delete set null`. Load-bearing for WP6:
   it's what puts a logged movement/photo on the correct process card.
   Old rows stay null (they render in the custody log, not on a card).
7. `models.py` mirrors all of it.
8. **RLS**: tasks/comments — org members read; creator, assignee, and
   owners write (creator+owner delete). notifications — a member reads
   only their own; inserts are server-side only (service role / SECURITY
   DEFINER — match how `0001` handles system-written rows). push_tokens —
   a member manages only their own rows.

### WP2 — API: tasks, notifications, push tokens, idempotent creates

1. **`routers/tasks.py`** — `POST/GET/PATCH/DELETE /orgs/{o}/tasks` and
   `GET/POST /orgs/{o}/tasks/{id}/comments`.
   - Any member creates. `assignee_id` must be an org member — 422
     otherwise. Exactly one assignee.
   - PATCH: creator and owners edit fields; assignee may only flip
     `status` (open↔done) and comment. `cancelled` is creator/owner.
   - DELETE: creator + owners. 404 cross-org everywhere (§8.2).
   - List filters: `assignee=me`, `creator=me`, `status=open|done`,
     `project=`, `document=`, `journal_entry=`. Ordered: open first,
     then soonest due_date, then created.
   - Assigning or re-assigning fires notification fan-out (below) with
     `kind: "task_assigned"`. Audit `task.created`/`task.updated`/
     `task.completed` matching existing `audit()` call style.
2. **`routers/notifications.py`** — `GET /orgs/{o}/notifications`
   (own rows only, `?unread=1` filter, newest first, cap 50),
   `POST /orgs/{o}/notifications/read` `{ids: []}` and `read-all`.
   No create endpoint — notifications are written by the server only.
3. **Push tokens** — `POST /orgs/{o}/push-tokens` upserts the caller's
   `{token, platform}` (refresh `last_seen_at`); `DELETE
   /orgs/{o}/push-tokens/{token}` removes it (logout). Member can only
   touch their own rows.
4. **`services/push.py`** — `send_push(user_id, title, body, data)`:
   collect the user's `push_tokens`, POST one batch to
   `https://exp.host/--/api/v2/push/send` via `httpx`, `data` carries
   `{entity_type, entity_id, kind}` for tap-through. No-op (log + return)
   when the user has no tokens — mirroring SMTP's config-gated silence.
   Swallow-and-log failures; push is best-effort, never blocks a request.
5. **`services/notify.py`** — add `record_notification(session, org_id,
   user_id, kind, payload)` writing the inbox row, and `notify_task`.
   Then restructure every notify call site into one fan-out: **inbox row
   + email + push**, same event. Call sites: existing project-lead and
   checklist-item assignment (they gain inbox+push for free), new task
   assignment, and the reminders below.
6. **`POST /internal/reminders`** — header `x-cron-secret` must match an
   env var, 403 otherwise, no-op when unset. Sends two reminder kinds:
   `task_due_soon` (open tasks due tomorrow, to assignee) and
   `duty_reminder` (members whose assigned journal day is today and have
   filed nothing — reuse the attendance "missing" logic). Each dedupes:
   one inbox row per (user, kind, entity, day).
7. **Idempotent creates** — `POST` bodies for journal entries, movements,
   documents, projects, and tasks accept optional `client_request_id`.
   On unique-violation, fetch and return the existing row with **200**
   (not 409 — replay should look like success). This is what makes the
   offline outbox safe: a retry after a post-commit timeout can't
   double-create a journal entry or a movement.
8. **Movement↔step link** — `POST .../movements` body accepts optional
   `step_id`; validate it belongs to the same document, 422 otherwise.
   This is the write side of WP6's photo-on-card join — the flow view is
   only as good as the link being recorded at log time.

### WP3 — Mobile: the offline core

The architecture: **one generic outbox under `api.js`**, not per-feature
queues. Every `post`/`patch`/`put`/`del` call funnels through it.

1. **Connectivity** — `@react-native-community/netinfo` wired to React
   Query's `onlineManager.setEventListener` in `app/_layout.jsx` (the
   canonical pattern from `expo-data-fetching`). Queries pause offline and
   resume online automatically; screens must treat
   `fetchStatus === 'paused'` as the offline state, not loading.
2. **Storage — your call, justify it.** Pick one and write a paragraph in
   your report defending the choice for *this* app (write volume, data
   size, query needs):
   - `expo-sqlite` — outbox table + snapshot tables (reference:
     `expo-examples` `with-sqlite`), or
   - AsyncStorage JSON outbox + `@tanstack/react-query-persist-client`
     with an AsyncStorage persister for the read cache.
   Requirements either way: the queue and cached reads **survive an app
   kill**, replay is strictly FIFO, and the pending/failed lists are
   queryable for the UI.
3. **The outbox** (`src/lib/outbox.js`) — op shape `{id, client_request_id,
   method, path, body, org_id, queued_at, attempts, status, last_error}`.
   When NetInfo says offline, or `api()` throws `NETWORK`/`TIMEOUT`, the
   mutation enqueues instead of erroring. The caller gets a `QUEUED`
   `ApiError` it can treat as accepted-but-pending — the UX rule: **the
   user sees their action accepted with a "queued" affordance, never an
   error toast.** Screens keep working; optimistically insert the pending
   row into local state where feasible, or rely on the banner + pending
   sheet.
4. **Replay** — fires on `onlineManager` reconnect, app foreground, and a
   manual "retry now". Sequential FIFO per org (the queue is org-scoped —
   replay carries the op's `org_id` in `x-org-id`, so switching orgs can't
   cross-wire writes). 5xx/network → retry with backoff; 4xx → `failed`
   with the server's message preserved; 401 → the existing auth-failure
   path. A queued create followed by a queued delete of the same client id
   collapses — both ops drop, nothing hits the wire.
5. **Temp-id remapping** — queued creates carry a client id. When the
   create replays and returns a real `id`, a remap pass rewrites the
   `path` and `body` of *every still-pending op* containing the client id.
   The canonical case: register a document offline, then log a movement on
   it offline — the movement's path has the temp document id until replay.
   This is a named requirement; test it.
6. **Photo staging** — offline photo flows stage the asset into the
   FileSystem documents directory and queue a composite op: signed-URL
   fetch → `uploadAsync` → the record create that references the
   `photo_path`. Retried as a unit; the staged file is cleaned only after
   the whole op lands. Works for journal photos and movement photos.
7. **UI** — a persistent `ConnectivityBanner`: offline → "You're offline
   — N changes will send when you're back"; online with pending →
   "Sending N changes…" / "All caught up". Tapping opens a pending-ops
   sheet: each op in words ("Journal entry for Monday", "Movement on
   Concept Paper — Reyes memo"), status, retry/discard for `failed` rows
   with the server's reason shown. Queued rows in lists get a subtle
   "queued" affordance. Dead-letter is a reviewable list — discard or
   fix-and-retry, nothing silently drops.

### WP4 — Mobile: push notifications

1. `npx expo install expo-notifications expo-device`; add the
   `expo-notifications` config plugin to `app.json` (Android icon + brand
   color — the `#27146e` already in `app.json`; an Android notification
   channel per the SDK-57 docs).
2. **Permission UX** — ask on first landing after login, not at splash;
   decline is graceful and never nags. Account/Settings gets a
   "notifications" row that deep-links to system settings.
3. **Token lifecycle** — register → `POST /push-tokens` on login and on
   the token-refresh listener; `DELETE` on logout. Skip silently when
   `expo-device` reports no device (web/emulator edge).
4. **Tap-through** — response listener maps `data.entity_type/id` to
   `router.push` under the `councilog` scheme: task → the task, document →
   `document/[id]`, journal → the entry, project → `project/[id]`.
5. Note in your report what works in Expo Go vs a dev-client build on SDK
   57 — the dev `eas.json` profile exists for a reason; don't overclaim.

### WP5 — Tasks + inbox surfaces (web and mobile)

1. **Tasks surface.** Web: `Tasks.jsx` page + `NAV` item. Mobile:
   `app/(tabs)/tasks.jsx` or a stack route — judge the tab bar's crowding
   and pick; link it from `more.jsx` and the Home "assigned to you" card.
   - List: filter chips (assigned to me / I assigned / open / done), rows
     show title, priority, due date (overdue in the danger tone),
     assignee name, and link chips that navigate to the entity.
   - Create/edit `Sheet`: title, description, member `Select` (reuse the
     members list), due date, priority, and an optional link picker —
     pick a project, a document, or a journal entry. Plain language:
     "Link this task to…".
   - Detail: status toggle (the assignee's one action), comments thread,
     edit/delete for creator+owner per WP2.
2. **The bell.** Both app shells get a bell icon with an unread badge;
   opens a list of the member's notifications — each row is a sentence
   ("Ana assigned you 'Draft the pubmat'" · 2h ago) that taps through to
   the entity and marks read; "mark all read" at the top. Unread count
   refetches on focus and on a sane interval — no websockets.
3. **Existing assignment upgrades for free** — checklist-item and
   project-lead pickers stay exactly where they are; they now also write
   the inbox row and fire push via the WP2 fan-out. Nothing about their
   UX changes.
4. **Guide/docs touchpoints** — the task flow and the inbox get a plain
   section in both `/guide` pages.

### WP6 — The visual paper trail (web and mobile)

Per-document flow view built from the `signatory_steps` + `movements`
already returned by `GET /documents/{id}` — join client-side on the new
`movement.step_id`, with `round_no` grouping revision rounds. Movements
with no `step_id` (pre-0010 rows, or desk-hops logged without a step)
render as a custody-log strip under the flow — they're still the record.
No graph libraries (dep ban); arrows are CSS/React Native primitives.

1. **Process cards.** Each step is a card: office (the desk, big),
   signer name, status chip in token colors — pending / at this desk /
   signed / sent back / skipped, derived from the real statuses
   (`pending`/`signed`/`revision_requested`/`superseded`/`skipped`;
   "at this desk" = the lowest-ord pending step of the current round) —
   timestamps, and the photo thumbnails of movements logged at that step
   (tap → the existing viewer pattern).
   Between cards: an arrow connector. Web renders horizontal scroll-snap
   at ≥md, vertical below that; mobile renders vertical. Same visual
   language both platforms.
2. **The paper's position is unmistakable.** Current step card gets the
   accent treatment; done steps are settled-looking; the latest
   movement's `location_text` shows under the current card ("last seen:
   SAS office, 2h ago").
3. **Log the current desk, with photo.** The current step's card carries
   the movement action — "Log arrival" with optional photo — and the
   sign/skip actions. Signing a step offers an optional photo too; the
   implementer chooses `steps.photo_path` column vs auto-creating a
   movement — the UX is fixed (attach a photo while marking a desk done),
   the schema choice is yours; justify it.
4. **Send-back loops render.** A `revision_requested` step + its
   `document_revisions` note draw a visible backward annotation (return
   arrow + "sent back — <reason>") so revision loops read as loops, not
   vanished history. `superseded` round-N cards stay visible but dimmed;
   round N+1 continues the flow (`revises` points back).
5. **Placement.** Web: a Flow panel on `DocumentDetail` above the
   existing timeline lists (they stay — Flow is the readable summary, the
   lists are the record). Mobile: the same on `document/[id]`. No chain
   attached → the existing attach-chain state, untouched.
6. `impeccable` runs before and after — `craft-floor.md` applies, and
   the result must earn "tells the story at a glance", not "a list with
   borders".

### WP7 — Open-ended improvements (≥3)

Audit the app — web first — and pick the three highest-value improvements,
weighted toward how chains and workflow state are visualized. For each:
write a mini-spec in your report (what, why it matters, what changes),
implement it, verify it. Non-binding inspiration, not a checklist: an
org-wide papers board (all in-flight documents as cards by current desk),
an agenda/calendar view of target dates and task due dates, notification
preferences (per-kind email/push opt-out), global search, member-directory
polish, dashboard "what needs me" consolidation. Don't sneak in §6 items.

### WP8 — Tests + docs + parity

1. `smoke_e2e.py` additions (its conventions): task CRUD, cross-org 404s
   on every new route, non-member `assignee_id` rejected, assignee-only
   status patch, comments, notifications list/mark-read/mark-all, push
   token upsert + dedupe, `client_request_id` replay returns the original
   row, cron endpoint 403 without the secret.
2. `v2/api/tests/` unit tests: task permission matrix, notify fan-out
   (SMTP + push mocked — dev stays silent), reminder dedupe logic.
3. Mobile outbox logic as **pure functions** — enqueue, replay ordering,
   temp-id remap, create+delete collapse, dead-letter transition — tested
   with `node --test` (zero new dev deps). Then append a manual
   airplane-mode verification checklist to `v2/mobile/README.md`.
4. `USER_GUIDE.md` + `spec.md` (§4 tables, §5 endpoints, §8.2) + both
   in-app `/guide` pages gain: an offline section (what queues, what the
   banner means, what a failed sync is and where to review it), a tasks
   section (assign, link, comments, done), a notifications section (bell +
   email + push), and the flow-view section (what the cards mean).
5. `DEPLOY.md`: `x-cron-secret` env + a scheduled caller (a GitHub Actions
   `schedule:` workflow hitting `/internal/reminders` is free — spec it),
   and the push ops flag — **`eas credentials` APNs/FCM setup is required
   before store builds deliver push**; say it plainly so it can't silently
   no-op in production.
6. `ROLES.md`: task permission matrix documented.
7. Shared-lib parity stays: if WP5/WP6 touch `rules.js`/`starterPack.js`
   on one platform, mirror on the other.

---

## §4 Acceptance criteria — the pass/fail list

- [ ] `cd v2/web && npm run build` passes; `pytest` passes (or additions
      flagged "requires running stack"); `npx expo lint` clean; `npx expo
      export` still bundles; migration `0010` applies cleanly.
- [ ] Airplane mode, mobile: file a journal entry with a photo, check off
      a checklist item, log a movement with a photo, sign a step, create a
      task — all queue, banner counts them, kill + reopen preserves the
      queue, reconnect replays **in order**, and the photo lands in
      storage.
- [ ] Register a document offline, log a movement on it offline: replay
      remaps the temp id — the movement lands on the real document.
- [ ] Kill the connection mid-replay after a create commits: the retry
      does **not** duplicate the row (`client_request_id`).
- [ ] A queued write replaying into a 4xx lands in the dead-letter list
      with the server's reason — reviewable, retryable or discardable,
      never silently dropped. Queued creates deleted while still queued
      never hit the wire.
- [ ] Member assigns a task linked to a project: assignee gets an inbox
      row, an email (when SMTP is set), and a push attempt — on both
      platforms. Task detail shows the link and taps through both ways.
- [ ] Checklist-item and project-lead assignment now produce inbox rows
      too — existing behavior plus, not instead.
- [ ] Push token registers on login, unregisters on logout, permission
      decline path is clean, and a notification tap deep-links to the
      entity.
- [ ] `/internal/reminders` 403s without the secret and sends deduped
      due-soon + duty reminders with it.
- [ ] Document detail, web and mobile: card-and-arrow flow renders;
      current desk unmistakable; movement photos appear on their step's
      card; a send-back round draws a visible loop. Works at 360px.
- [ ] Tasks surface, bell + unread badge, and notification list exist and
      work on **both** platforms.
- [ ] Three improvements shipped with mini-specs in the report.
- [ ] `USER_GUIDE.md`/`spec.md`/both `/guide` pages/`DEPLOY.md`/`ROLES.md`
      synced; no secrets; no tool attribution; no `.ts`/`.tsx`; no
      non-whitelisted deps.

---

## §5 Verification sequence

1. `cd v2/web && npm run build` — must pass before claiming done.
2. `pytest` — report tails; smoke additions if a live stack exists.
3. `cd v2/mobile && npx expo lint` and `npx expo export --platform android`
   — the CI bundle check must stay green.
4. `node --test` on the outbox suite.
5. Manual airplane-mode pass on a device or emulator per the README
   checklist you write in WP8 — walk every acceptance bullet that needs a
   radio.
6. Manual smoke: assign a task each direction on web and mobile; read the
   inbox; run the flow view on a paper with a send-back round and photos.
7. If `impeccable` is installed: `impeccable detect --json` on changed
   web/mobile files; fix real findings, skip noise contradicting §2.

---

## §6 Out of scope

Recurring tasks, task templates, subtasks, real-time websockets or live
collaboration, offline support on the web/PWA (mobile only — the web is a
desk tool), SMS notifications, notification preferences UI (fair game as
a WP7 pick), attachments beyond photos, encrypted offline storage,
conflict-merge UIs beyond the dead-letter list, per-office auth, enforced
signing order, and any non-whitelisted dependency. Note
deliberately-deferred ideas in a short "future polish" section of your
report — don't sneak them in.

## Output format

1. Ordered list of files changed/created with a one-line "why" each.
2. Build + test output tails.
3. The §4 checklist with actual pass/fail results.
4. The WP3 storage decision with its justification; the WP6 photo schema
   decision with its justification.
5. Any deviation from §3 (and why).
6. The three WP7 mini-specs and their results.
7. Short future-polish notes.
