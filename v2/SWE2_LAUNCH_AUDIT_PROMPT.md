# SWE-2 Max Prompt — CounciLog: pre-launch audit & dual-Vercel ship

You are a senior product engineer doing a **hostile pre-launch audit** of
CounciLog. The app is going live on two Vercel hobby projects —
`v2/web` (React/Vite static SPA) and `v2/api` (FastAPI serverless) — with
Supabase Postgres + Auth + Storage underneath. Your mission has three parts:

1. **Audit everything listed below, adversarially.** Assume the code is
   broken until you have evidence it isn't. You are forbidden from reporting
   "works" or "no problem" without citing the test run, HTTP response,
   browser session, or log line that proves it. Anything you cannot exercise
   is marked **UNVERIFIED** — never claimed as passing.
2. **Fix everything you safely can.** Bugs, security holes, broken flows,
   missing error/loading states, deployment config — fix and prove. The only
   things you escalate instead of fixing are product-level decisions and
   anything requiring accounts/credentials you don't have.
3. **Make both apps deployable** and leave a `DEPLOY.md` the owner can
   follow for the manual dashboard steps (Vercel projects, Supabase prod
   config). Finish with a severity-ranked launch-blocker report.

Work at the repo root (`CouncilLogV2/`). App code lives in `v2/web/` +
`v2/api/` + `v2/supabase/migrations/`. `legacy_code/` is read-only history.

---

## §1 Read before you touch anything

1. `v2/PRODUCT.md` — audience: student officers on low/mid-range Android
   phones on campus Wi-Fi. Plain language over jargon, always.
2. `v2/DESIGN.md` — tokens, primitives, four-variant theme system. Source of
   truth for styling.
3. `v2/spec.md` — all of it. §5 is the API inventory + role matrix, §6 the
   screen inventory (every screen needs loading/empty/error/403 states), §8
   the threat model you audit against, §10 NFRs, §13 open questions.
4. `v2/USER_GUIDE.md` + `v2/ROLES.md` — the user-facing flows and the
   member/officer/adviser/owner capability matrix.
5. `COUNCIL_HANDBOOK_V2.md` — the real council workflows the app models.
6. `AGENTS.md` (repo root) — UX rules are launch requirements here: never a
   silent no-op; every empty state and error names the cause AND the next
   step; preview before commit; escape hatches over dead ends.
7. All of `v2/api/app/` — `main.py` (CORS, error handlers, router mounts),
   `config.py` (env vars + defaults), `security.py` (JWKS→HS256 JWT verify),
   `deps.py` (the single `authorize()` chokepoint), `db.py` (pooler-aware
   engine), `errors.py` (error envelope), `pagination.py` (cap=100),
   `models.py` (23 tables), `services/` (storage signed URLs, auth ban,
   SMTP notify), and every router file end-to-end.
8. All of `v2/web/src/` — `main.jsx` (routes), `lib/api.js`, `lib/auth.jsx`,
   `lib/org.js`, `lib/supabase.js`, `lib/theme.jsx`, `lib/toast.jsx`,
   `lib/rules.js`, `components/` (AppShell, ui.jsx primitives, PhotoPicker,
   MemberManager, ChecklistPreview), and all 13 pages.
9. `v2/supabase/migrations/0001–0004` — FK graph + every RLS policy.
10. `v2/api/tests/` — pytest style + `smoke_e2e.py` conventions.
11. If the `impeccable` skill is installed: run
    `impeccable context --target v2/web` once at session start and read
    `reference/craft-floor.md` before your first UI edit. If the
    `security-and-hardening`, `shipping-and-launch`, `test-driven-development`,
    or `browser-testing-with-devtools` skills are installed, apply them to
    the matching work packages below. Skip silently if absent.

---

## §2 Hard constraints — violations are regressions

- **Plain JavaScript/JSX.** No TypeScript anywhere.
- **No new runtime dependencies** unless one is required to close a
  launch-blocking hole — and then justify it in the output. Prefer building
  on what's installed.
- **Token-driven styling.** `var(--*)` only — no literal hex, no `bg-white`.
  All four theme variants (brutalist-light default, brutalist-dark,
  classic dark, classic light) must pass WCAG AA; ≥44px touch targets;
  fully usable at 360px. Reuse `Button`/`Field`/`Input`/`Select`/`Card`/
  `PageHeader`/`Chip`/`Empty`/`Sheet`/`ConfirmDialog`/`Skeleton`/`Avatar`/
  `HintBanner` — don't fork them.
- **Thin client.** The web app talks to FastAPI only, plus Supabase Auth and
  signed-URL Storage PUT/GET. No direct table access, no service key anywhere
  near the client bundle.
- **`authorize()` on every org-scoped route.** Membership + min-role resolved
  server-side per request; non-members get 404 (org invisibility), low-role
  members get 403. No endpoint ships without it; no client-supplied role
  claims trusted.
- **Error envelope preserved.** `{error: {code, message, details?}}` —
  never stack traces, never PII in messages.
- **No secrets in the repo or logs.** `.env` files stay untracked;
  `.env.example` files get placeholders only. Per repo `AGENTS.md`: no AI
  or tool attribution anywhere — commit messages, code comments, footers,
  docs.
- **Append-only history.** Never mutate/delete audit_log, movements, or
  resolved signatory-step rows to fix something — corrections append.
- **Don't regress what works.** The papers revision rounds, checklist
  instantiation, photo upload path, and role matrix all have spec'd behavior
  — changes must preserve it.

---

## §3 Audit method — evidence or it didn't happen

1. **Boot the stack.** `v2/api/.env` and `v2/web/.env` exist locally with a
   real Supabase project. Run uvicorn + vite, create test users/orgs, and
   exercise the app end to end. If the local env can't run, say so
   immediately and mark every runtime check UNVERIFIED.
2. **Enumerate before judging.** List every route in `main.jsx`, every
   endpoint in the routers, every form/submit handler, every RLS policy,
   every `Link`/`navigate()` target — then check each off individually.
   A page you didn't open is a bug you didn't find.
3. **Two-org testing is mandatory.** Create Org A and Org B with separate
   users; B's token must get 404/403 on every A resource — API paths,
   `X-Org-Id` mismatches, and signed photo URLs. This is spec §8.2's
   mandatory acceptance test; automate it.
4. **Role-ladder testing.** The same flow must be checked as member,
   officer, adviser, and owner — including that the UI hides/explains what a
   role can't do rather than erroring on submit.
5. **Hostile inputs.** Invalid UUIDs in path params, wrong types, missing
   fields, oversized bodies, `<script>` payloads in text fields, duplicate
   submissions, expired tokens mid-session.
6. **Hostile networks.** Browser network throttling (slow 3G) for every
   primary flow; go fully offline mid-submit; kill the API mid-request.
   Watch for stuck spinners, silent failures, and double-sends.
7. **Every UI state.** Per spec §6, every screen needs loading / empty /
   error / 403 states. Empty states name cause + next step per AGENTS.md.
   Hunt infinite loaders and dead ends.
8. **Phone viewport first.** All checks at 360px before 1280px, in all four
   themes. Sheets usable one-handed; nothing clipped under the bottom tab
   bar; no color-only status signaling.
9. **Seeded suspects — verify, don't trust.** These were spotted during
   planning; prove or disprove each:
   - No `vercel.json` exists for either app. The SPA will 404 on every deep
     link under Vercel; FastAPI needs a serverless entry/rewrite config.
   - `main.jsx` has **no catch-all `*` route** — unknown URLs render the
     shell with a blank content area instead of a 404 page.
   - `requirements.txt` is unpinned `>=` ranges — non-reproducible deploys,
     violates spec §8.10.
   - No security headers configured anywhere (spec §8.10 requires CSP, HSTS,
     X-Frame-Options, nosniff, Referrer-Policy).
   - The anti-FOUC inline `<script>` in `index.html` will be blocked by a
     strict CSP — handle it (hash or move to module), don't just disable CSP.
   - No rate limiting exists (spec OQ3) — see WP11 for the chosen approach.
   - `/api/v1/docs` + `openapi.json` are served unconditionally — must be
     gated to `ENV=dev` or disabled in production.
   - `WEB_ORIGIN` accepts exactly one origin — Vercel preview deployments
     (`*.vercel.app`) will be CORS-blocked; decide and document behavior.
   - **Committed junk:** `v2/api.log`, `v2/api/api-server.log`,
     `v2/fd3fe373-05ed-49cd-940b-90e366d62b44.jfif` are tracked in git. The
     logs contain org IDs and at least one **invite code** — a redeemable
     capability grant. Remove them, gitignore `*.log`, and check whether the
     code is still redeemable (revoke/rotate if so).
   - `Login.jsx` calls `nav('/')` immediately after `signUp` — dead end if
     the Supabase project has email confirmation enabled (no session, no
     feedback). No password-reset flow exists at all.
   - `api.js` has no fetch timeout/abort, no retry, and sends requests with
     no Authorization header when the token is null instead of failing fast
     or redirecting to login.
   - `AppShell.jsx` calls `setCurrentOrg` (localStorage write) during render
     — a StrictMode side-effect bug.
   - `services/notify.py` silently no-ops when SMTP is unconfigured — audit
     every caller for AGENTS.md "never a silent no-op" violations.

---

## §4 Work packages

### WP1 — Auth & session

Audit and fix the full identity loop:

- Email/password **sign in**: wrong password, unknown email, empty fields,
  network failure — each shows a specific, plain-language error.
- **Sign up**: verify behavior under BOTH Supabase email-confirm settings.
  If confirmation is on, the post-signup screen must say "check your email"
  and link back to sign-in — never dump the user into a session-less app.
  Decide which mode production uses and document it in DEPLOY.md.
- **Google OAuth**: `signInWithOAuth` → `/auth/callback` exchange → landing.
  Verify the callback handles an already-authenticated user, an error param
  in the URL, and a cancelled consent screen. Document the Supabase
  redirect-URL + Site URL config DEPLOY.md needs.
- **Session lifecycle**: expired access token → supabase-js refresh → API
  retry transparently; refresh failure → clean redirect to `/login`, never
  a cascade of 401 toasts. Sign-out clears org context and session.
- **Password reset**: either wire `supabase.auth.resetPasswordForEmail` +
  an update-password screen, or file it as an explicit HIGH finding if you
  judge it out of deploy scope — a login page with no recovery path is a
  support nightmare.
- **Guards**: every `AppShell` route requires a session; `/onboarding` is
  reachable org-less; `/account` must stay reachable for org-less users.
- **`DELETE /me`**: anonymize + ban works; sole-owner case returns 409 with
  a message that says WHY and what to do instead.

### WP2 — Forms & validation

Enumerate every form (login, onboarding create/join, journal compose,
no-tasks declaration, project create/edit, document register, movement,
sign/skip/revision sheets, chain/template/duty/position/contact editors in
Settings, invites, join requests, member role changes, account profile,
avatar upload, account delete). For each:

- Invalid input shows the API's error message in place — never swallowed,
  never a bare "Something went wrong" when the server sent a real message.
- Submit buttons disable while in-flight; double-clicking can't double-post.
- Client-side `maxLength` matches server schema bounds.
- Confirm destructive actions via `ConfirmDialog` (with `requireText` for
  account deletion — verify it exists).
- Escape hatches per AGENTS.md: if a mismatch can't be fixed on-screen
  (e.g. unrouted document with no matching chain), offer the manual picker
  gated to the right role — never a dead end.

### WP3 — API client & calls

Harden `v2/web/src/lib/api.js` without changing its call sites:

- Add a request timeout + AbortController (sensible default ~15s) — a hung
  request must resolve to an `ApiError`, not an eternal spinner.
- On 401: force sign-out + redirect to `/login` (via supabase signOut and
  navigation — decide the cleanest seam; the lib currently can't import
  navigate, so wire an auth-failure callback the provider registers).
- On network failure/`TypeError`: produce `ApiError('NETWORK', …)` so pages
  can distinguish "server said no" from "you're offline" — offline errors
  should say so in plain language.
- Verify `x-org-id` stays correct when the org switcher changes orgs
  mid-session — stale-org writes are a data-integrity bug. Check every
  TanStack Query `queryKey` includes what it depends on (org id, params)
  and every mutation invalidates what it changes.

### WP4 — Permissions & tenancy

- Verify each endpoint's `authorize(min_role)` against the spec §5 matrix —
  print the actual table you audited, endpoint by endpoint, in the report.
- The mandatory cross-org suite (§3.3): automate org-B-token-vs-org-A-IDs
  across every endpoint; all must be 404/403.
- UI-side: every page hides or explains actions the current role can't take
  (officer sees why they can't open Settings → invites; member sees read-
  only states where applicable). 403 responses render a friendly "ask an
  owner" state, not a crash or blank card.
- `PATCH /me` field allowlist: confirm role/org writes are rejected even if
  a crafted client sends them.
- Invite hardening: `max_uses`, `expires_at` enforced; redeemed/exhausted/
  expired codes return clean 4xx — and the UI tells the joiner which one.

### WP5 — Database & RLS

- Audit every policy in `0001–0004` for org scoping: `is_org_member`/
  `has_org_role` where appropriate; `join_requests` self+owner pattern;
  `profiles` self-only writes. Look for tables the app writes via the API
  that also permit client writes — deny-by-default must hold because the
  web client never queries tables directly.
- Storage: `journal` bucket must be private with signed URLs (TTL ≤
  `SIGNED_URL_TTL_SECONDS`=900s); `avatars` intentionally public — confirm
  no non-avatar object can land there (`POST /me/avatar/sign` path scoping).
- Signed-URL minting re-checks org membership (org-A photo URL must not be
  mintable by org-B member — test it).
- `photos/{id}/url` must only serve photo rows of the caller's org; check
  the journal-photo → entry → org join.
- Verify upload constraints end to end: mime allowlist (jpeg/png/webp),
  ≤5MB, server-chosen path `{org}/{entry}/{uuid}`, magic-byte check on
  entry create. Try to upload a `.exe` renamed `.jpg`.
- Run Supabase's advisors/linters if the MCP server is available; report
  unindexed FKs and permissive policies.

### WP6 — Security sweep

- **Secrets**: confirm no `.env` files tracked; scan committed files
  (`api.log`, `api-server.log`, `.jfif`, history per spec §8.8's council-
  Gmail note) for keys/tokens/PII; remove the junk files and gitignore
  `*.log`. Report what the logs leaked (invite codes, org ids) and whether
  rotation is needed.
- **Service-role key**: grep the web bundle for any path it could reach —
  it must exist only in API env.
- **XSS**: `dangerouslySetInnerHTML` audit (expect zero on user data);
  CSP is the mitigation for the localStorage-token residual risk (§8.4) —
  implement it correctly.
- **Dependency audit**: `npm audit` in `web/`; `pip-audit` (or
  `pip list --outdated` + advisory check) in `api/`. Fix or justify every
  critical/high.
- **Docs exposure**: `/api/v1/docs` + `openapi.json` gated to `ENV != prod`.
- **Error hygiene**: no stack traces, internals, or PII in any 4xx/5xx
  body; `unhandled_error_handler` stays generic.
- **Invite codes** are capability grants: verify entropy, `max_uses`,
  `expires_at`; the committed log sample exposed one — check redeemability.
- CORS: `allow_methods=["*"]` + header allowlist is acceptable for Bearer
  auth, but origins must be exact in prod — no wildcard, no dev regex when
  `ENV=prod` (verify the `env` flag actually gates it).

### WP7 — UX states & mobile

- For all 13 routes: loading (Skeleton/spinner that can't stick), empty
  (`Empty` with cause + next-step link per AGENTS.md), error (message +
  retry), 403 (friendly explanation + who to ask).
- 360px × all four themes on every screen: nothing clipped by the bottom
  tab bar, sheets reachable one-handed, ≥44px targets, chips carry
  label + icon.
- Theme switch mid-session doesn't lose state; anti-FOUC script still works
  under the CSP you add.
- `PhotoPicker` capture flow on mobile (`input capture`) — verify accept
  types and failure states.
- Console clean: no stray `console.log`; `ErrorBoundary`'s `console.error`
  is fine.
- Plain-language pass on all new/changed strings — officers, not devs.

### WP8 — Critical flows, end to end

Run each flow in the real app, not by reading code:

1. Sign up → confirm → `/onboarding` → create org → lands as owner on
   Dashboard.
2. Owner mints invite → second account redeems → sees org data instantly.
3. Third account files join request → owner approves with role → member
   sees data; rejected requester sees nothing.
4. Officer files journal entry with photo (sign → PUT → entry → signed-view
   round trip) → day shows `documented`.
5. Officer files "no tasks" → `declared_no_tasks`; unfiled weekday shows
   unaccounted in roster/attendance views; summary % matches roster math.
6. Owner creates checklist template + project → instantiate → items appear;
   officer checks an item.
7. Owner creates signatory chain → officer registers document → chain
   attaches → movement logged → sign/skip steps → "sent back for revision"
   → round-2 re-signs → "sign all pending" → doc `signed`.
8. Owner edits positions/duty schedule/contacts in Settings; member sees
   read-only versions.
9. Owner changes a member's role → effective immediately; removes a member
   → they get 404s on next request, history retained.
10. Account: display name, avatar upload (public bucket path), password
    change via Supabase, theme, sign-out, delete account (incl. sole-owner
    409 path).
11. Org switcher with a user in two orgs — every page scopes correctly,
    no cross-org leakage via stale `x-org-id`.

### WP9 — Routing, links, pages

- Add the missing catch-all `*` route → a real NotFound page (plain message
  + link home), inside `AppShell` so it keeps nav.
- Click every `Link`, `NavLink`, `navigate()`, `<a>` in the app — incl. the
  settings-jump links in empty states and the org-switcher `__new` option —
  and confirm each target exists and lands correctly.
- Deep-link test: hard-refresh and direct-load `/documents/<id>`,
  `/settings`, `/account` — must render (this also exercises the Vercel SPA
  rewrite in WP11).

### WP10 — Edge cases & load

- Slow 3G: every list/detail page shows skeletons not blank; mutations show
  pending state; no race between two rapid mutations.
- Offline: mid-submit network drop → honest error + retry path; data not
  silently lost (form state preserved or clearly reset).
- Invalid input: malformed UUIDs (`/documents/abc`), huge `pageSize`,
  negative `page`, unicode/emoji/RTL in names, 10KB strings, empty bodies.
- Concurrency: two tabs signing the same step → second gets a clean 409;
  double-submit of create forms → no duplicates (server 409s or UI disables).
- Pagination boundaries: 0 items, 1 item, exactly pageSize, page beyond
  last — no crash, no empty-without-explanation.
- Uploads: >5MB, wrong mime, renamed executable, zero-byte file, cancelled
  picker, upload succeeding then entry-create failing (orphaned object —
  note sweeper is P5, but the UI must surface the failure).
- Burst sanity: hammer a list endpoint ~30 req/s for a few seconds —
  no 5xx, reasonable latency; confirm the rate limiter (WP11) trips where
  spec'd and returns a clean 429 with a friendly UI message.
- Date edge: Asia/Manila "today" boundary — an entry filed near midnight
  lands on the right `day`.

### WP11 — Deploy readiness (the ship work)

**Web (`v2/web`)** — project root `v2/web`, framework Vite:

- `web/vercel.json`: SPA rewrite (`/(.*)` → `/index.html`), asset caching
  headers for `/assets/*` (immutable, hashed filenames), and the §8.10
  header set — CSP (`default-src 'self'` + Supabase URL for
  connect/img + inline-script handling for the anti-FOUC snippet — hash it
  or relocate it, don't `'unsafe-inline'` scripts), HSTS,
  `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`,
  `Referrer-Policy strict-origin-when-cross-origin`. Verify against current
  Vercel docs.
- Env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`
  documented; `VITE_API_URL` points at the api project's URL + `/api/v1`.
- `npm run build` clean; bundle sanity (no sourcemaps leaking internals,
  reasonable chunk size for campus Wi-Fi).

**API (`v2/api`)** — project root `v2/api`, Vercel Python runtime:

- Add the entry config the current Vercel docs prescribe for FastAPI
  (`vercel.json` routing all traffic to the `app` ASGI object — verify the
  exact current format; do not cargo-cult an old tutorial). `/api/v1/*`
  paths must route through unchanged; `GET /health` stays public and
  fast — it doubles as the post-deploy smoke check.
- Pin `requirements.txt` to exact versions from the working venv
  (`pip freeze`-style pins; keep pytest/aiosqlite as test deps however
  Vercel handles them — verify they don't break the build).
- `ENV=prod` behavior: dev CORS regex off, docs/openapi off.
- CORS: `WEB_ORIGIN` = the production web URL. Decide + document the
  preview-deploy answer (either a documented `*.vercel.app` origin regex
  scoped to `ENV != prod`, or previews simply don't reach prod API — pick,
  write it in DEPLOY.md).
- Function-time budget: every external call (JWKS fetch, storage REST,
  SMTP, auth admin) has timeouts (already ~5–10s — keep ≤ hobby max);
  audit endpoints for work that could blow the limit.
- **Rate limiting** (spec OQ3 — decided): implement a Supabase-table
  counter — migration `0005_rate_limits.sql` + a small `check_rate_limit`
  service/dependency — on: join-requests 10/15min, invite mint 20/hr,
  photo-sign 60/hr per spec §8.10; clean `429` + `RATE_LIMITED` code and a
  plain-language UI state. Note Upstash Redis in DEPLOY.md as the
  documented upgrade path when traffic grows. No external deps for v1.

**Supabase production checklist** (for DEPLOY.md, agent can't click):

- Run migrations `0001–0005` in order in the SQL Editor.
- Create private `journal` bucket; confirm `avatars` exists/public.
- Auth: Site URL = prod web origin; redirect URLs incl.
  `/auth/callback`; Google provider configured; email-confirm decision
  documented (WP1); password-reset redirect if added.
- Rotate anything the committed logs or git history exposed.
- Env matrix: exact var list per Vercel project with where-to-get-it notes
  (extend README §2 tables rather than duplicating stale).

### WP12 — DEPLOY.md

Write `v2/DEPLOY.md` — a numbered, plain-language runbook the owner follows:

1. Create the two Vercel projects (root dirs, env vars per project).
2. Supabase prod checklist (above) in order.
3. Point `VITE_API_URL` ↔ `WEB_ORIGIN` at each other; deploy order
   (api first, then web, then re-set `WEB_ORIGIN` if needed).
4. Post-deploy smoke: health, login, signup, OAuth, one full WP8 flow,
   a deep-link refresh, a 360px pass on a real phone.
5. Rollback note (Vercel instant-rollback to previous deployment; DB
   migrations are forward-only — new migration to fix).
6. "First week" watch items: Vercel function logs, Supabase logs, SMTP
   delivery, invite-code hygiene.

---

## §5 Acceptance criteria — pass/fail, evidence required

- [ ] `cd v2/web && npm run build` passes clean; `cd v2/api && pytest -q`
      passes (or new tests flagged "requires live stack").
- [ ] `web/vercel.json` and `api/vercel.json` (or documented equivalent)
      exist and were validated against current Vercel docs.
- [ ] `requirements.txt` pinned; `package-lock.json` unchanged unless a dep
      was justified.
- [ ] Every seeded suspect in §3.9 resolved: fixed, disproven with
      evidence, or carried to the blocker report with severity.
- [ ] WP8 flow list: each marked PASS (with how verified) or FIXED or
      UNVERIFIED — zero "assumed working".
- [ ] Cross-org access test run and green (or explicitly UNVERIFIED).
- [ ] Rate limiting live on the three spec'd endpoints; clean 429 path.
- [ ] Security headers served on web responses; CSP verified working
      (theme script, Supabase calls, images all function).
- [ ] Docs/openapi unreachable in `ENV=prod`.
- [ ] No `.env`/keys/secrets in tracked files; log files removed +
      ignored; invite-code exposure assessed.
- [ ] Every screen has loading/empty/error/403 states; every empty state
      names cause + next step; zero silent no-ops found or remaining.
- [ ] 360px + four themes verified on all 13 routes; ≥44px targets; no
      color-only signaling.
- [ ] Launch-blocker report delivered (see Output format) — every BLOCKER
      and HIGH either fixed or explicitly flagged as requiring user action
      (credentials, dashboard clicks, product decision).
- [ ] `DEPLOY.md` written; README env tables updated if vars changed.
- [ ] No TS, no unjustified deps, no secrets, no tool attribution.

---

## §6 Verification sequence

1. `npm run build` (web) + `pytest` (api) — green before claiming done.
2. Boot the stack locally; run the WP8 flows in order with the browser
   (chrome-devtools MCP if configured, else drive manually and capture
   console/network output).
3. Re-run every fixed bug's repro to confirm the fix, not just the code.
4. `vercel build` / `vercel deploy --prebuilt` dry-run per project if the
   CLI is available; otherwise statically validate `vercel.json` against
   docs and mark UNVERIFIED.
5. Final pass: `git status` clean of junk; diff review for secrets,
   attribution, literal hex, `.ts` files.
6. If `impeccable` installed: `impeccable detect --json` on changed web
   files; fix real findings, skip stylistic noise contradicting §2.

---

## §7 Out of scope

Clicking Vercel/Supabase dashboards yourself (DEPLOY.md covers it), buying
or configuring a custom domain, the Expo mobile app (P6), `legacy_code/`
changes, Upstash provisioning (documented future path only), per-office
auth (product decision, unchanged), P5+ features (org export UI, in-app
notifications, orphaned-upload sweeper), removing Vercel hobby-tier limits.

---

## Output format

1. Ordered list of files changed/created with a one-line "why" each.
2. Build + test output tails.
3. **Launch-blocker report** — a table, one row per finding:
   `severity (BLOCKER/HIGH/MED/LOW) | area | evidence | status
   (FIXED — proof | OPEN — what's needed | UNVERIFIED — why)`.
   Sort BLOCKER first. No row may say "looks fine" — only evidence.
4. The §5 checklist with actual pass/fail.
5. WP8 flow table with per-flow verification notes.
6. Deviations from §4 and why.
7. Residual risks + recommended post-launch work (Upstash migration,
   sweeper, monitoring, etc.).
