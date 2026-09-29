# SWE-2 Max Prompt — CounciLog: Expo mobile app (full parity) + landing page

You are a senior product engineer. CounciLog already runs a complete
multi-tenant platform: a FastAPI backend (`v2/api`), a React+Vite web app
(`v2/web`), and Supabase Postgres/Auth/Storage (`v2/supabase`). `PRODUCT.md`
always planned a React Native/Expo client "as a later phase on the same API
contract." That phase is now.

Your mission, in three parts:

1. **The mobile app** — a full-parity Expo app at `v2/mobile/` for iOS +
   Android. Every screen the web app has exists on native: Today, Journal
   (camera), Attendance, Projects, Papers (move/sign/skip/revise), Members,
   Guide + starter library, Settings (all tabs + danger zone), Account,
   Admin, Onboarding. Students file duty from phones in hallways — this is
   the *primary* surface, not a companion.
2. **The ecosystem** — three clients, one backend, one Supabase project.
   **The API does not change.** It is already multi-client by design
   (stateless `Authorization: Bearer <supabase-jwt>` + `X-Org-Id` header on
   every org route). Web and app are equal peers: an org created on web
   appears on the phone, a journal filed on the phone shows on the browser.
   Concurrency is a property you inherit — do not rebuild it.
3. **The landing page** — a standalone static hero at `v2/landing/` that
   introduces CounciLog and routes visitors to "Use the web app" or "Get
   the app" — the front door for the whole ecosystem.

Work at the repo root (`CouncilLogV2/`). You are creating `v2/mobile/` and
`v2/landing/`. `v2/api/` is read-only. `v2/web/` is your reference
implementation — port it, don't fork its logic.

---

## §1 Read before you touch anything

1. `v2/PRODUCT.md` — audience (student officers on phones between classes),
   plain-language voice, "org-shaped, not org-coded". The phone is the real
   device — mobile is not a shrunken web page.
2. `v2/DESIGN.md` + `v2/neo-brutalist-style-guide.md` — design system:
   tokens, primitives, voice. The app must *feel* like the same product.
3. `v2/spec.md` — the contract. §2 roles (`member < officer < adviser <
   owner`, plus `profiles.is_admin` platform admin), §4 data model, §5 the
   full API table (45 routes — your client consumes ALL of them, adds
   none), §7 configurable workflows (snapshot semantics, condition keys),
   §8 security model.
4. `v2/web/src/lib/api.js` — **the reference client**. Port it 1:1: Bearer
   token from the Supabase session, `X-Org-Id` header from stored org id
   (or per-call `{org}` override), 15s `AbortController` timeout, `ApiError`
   with `code`/`status`/`details`, the `ORG_LOADING` guard, 401 → sign-out
   handler. The one change is where the token comes from (WP2).
5. `v2/web/src/lib/org.js` — current-org persistence (localStorage →
   AsyncStorage) + `atLeast` role helper.
6. `v2/web/src/lib/rules.js` — **pure JS, no DOM, no imports**. The matching
   engine mirror (`diagnoseChecklist`, `matchingChain`, flag collectors,
   `describeCondition`/`describeItemRule`). It copies verbatim into the app.
7. `v2/web/src/lib/starterPack.js` — **pure data**. The CCS starter library
   copies verbatim too — Guide/library parity is nearly free.
8. `v2/web/src/components/ui.jsx` + `AppShell.jsx` — the primitive set you
   port (§WP3) and the nav structure you mirror (§WP4).
9. `v2/web/src/pages/` — every screen. `Login.jsx` (modes in/up/forgot +
   Google), `Onboarding.jsx`, `Dashboard.jsx`, `Journal.jsx`,
   `Attendance.jsx`, `Projects.jsx`+`ProjectDetail.jsx`,
   `Documents.jsx`+`DocumentDetail.jsx`, `Members.jsx`, `Guide.jsx`,
   `Settings.jsx` (8 tabs + DangerZone), `Account.jsx`, `Admin.jsx`.
10. `v2/web/src/components/` — `MemberManager`, `TemplateEditor`,
    `ChainEditor`, `RuleFields`, `FlagCheckboxes`, `ChecklistPreview`,
    `ChainPreview`, `PhotoPicker` — the feature components behind the
    screens; each has a native counterpart.
11. `v2/DEPLOY.md` — deployment shape today (web + api + Supabase). You add
    two pieces to its diagram.
12. `v2/USER_GUIDE.md` — Part A/B so the app's wording matches what members
    already read.

## The footguns — learn from what already bit us

- **`expo-secure-store` overflows Supabase sessions.** Its 2KB value cap is
  smaller than a Supabase JWT+refresh pair. Session storage is
  `@react-native-async-storage/async-storage` — non-negotiable.
- **`detectSessionInUrl: false`** in the native `createClient` — there is
  no URL on a phone; leaving it true makes auth hang.
- **OAuth needs `councilog://` deep links + `skipBrowserRedirect`**, not a
  web redirect. Flow below in WP4.
- **Expo Go won't do this cleanly** (custom scheme, native modules). Use
  `expo-dev-client` dev builds.
- **Modal/sheet height** — the web just had a bug where tall forms
  overflowed the screen (Sheet had no max-height/scroll). Every native
  form sheet is `Modal` + pinned header + `ScrollView` body capped near
  viewport height **from day one** — don't re-learn it.
- **Password-reset + email-confirmation links land on the WEB** pages
  (`/auth/callback`, `/reset-password`) — that's correct and shared. A
  phone user resetting gets the web page in their browser; do not rebuild
  reset inside the app.
- **CORS doesn't apply to native** — no `WEB_ORIGIN` work needed.
- **Snapshot semantics & flag vocabulary are shared** — `rules.js` mirrors
  `instantiate.py`; the copied file must stay in sync (comment it, and
  note the pairing in mobile README — same discipline as web already has).

---

## §2 Hard constraints — violations are regressions

- **Zero API changes.** Not one line in `v2/api/`. If you think an endpoint
  is missing, you missed it in spec §5 — ask or re-read.
- **One Supabase project.** Same URL/anon key envs as web. No separate
  auth, no second database, no per-platform tables.
- **Plain JavaScript/JSX.** No TypeScript — the codebase is `.jsx`/`.js`.
- **expo-router** for navigation (file-based; mirrors the web routes),
  `@tanstack/react-query` for server state (web already uses it — same
  mental model), `@supabase/supabase-js`, `expo-image-picker`,
  `expo-web-browser`, `expo-auth-session`, `expo-dev-client`,
  `@react-native-async-storage/async-storage`, `lucide-react-native`.
  No other dependencies without justification.
- **Token-ported styling.** Port `index.css`'s four palettes to a JS token
  module — same variable names (`--color-surface-2` → `colors.surface2` is
  fine, keep the *names* traceable), same four themes, `useColorScheme` for
  the default. No hardcoded hex in components. Brutalist offset shadows →
  a shared `shadowBox` style helper (`shadowOffset` on iOS; border-only
  fallback on Android where elevation can't do offset).
- **44px touch targets**, thumb-reach layout, `KeyboardAvoidingView` on
  forms, `ScrollView` bodies in every sheet.
- **Thin client.** All rule evaluation stays server-side; `rules.js` is
  preview-only. Never invent a rule shape.
- **Plain language** everywhere (repo `AGENTS.md`): "Who signs, in order",
  not "signatory chain". Every empty state names the cause + next step.
  Preview before commit on every matching surface.
- **No secrets in the repo** (`EXPO_PUBLIC_*` vars are public-by-design,
  like `VITE_*` — the service key never enters the app). **No AI/tool
  attribution** anywhere.

---

## §3 Work packages

Each WP must leave the app runnable (`npx expo start` → dev build opens
what exists so far). No big-bang.

### WP1 — Scaffold `v2/mobile/`

- `npx create-expo-app@latest` into `v2/mobile/` with the **expo-router**
  template; strip the demo screens. Keep plain `.jsx`/`.js`.
- `app.json`: name `CounciLog`, scheme `councilog`, `userInterfaceStyle`
  `"automatic"`, Android package + iOS bundle id (`com.councilog.app` or
  similar), splash/icon using the brand accent (`#f4be04`) — generate
  simple placeholder icons; a designer pass is not required.
- `package.json` scripts: `dev` (dev-client start), `android`, `ios`,
  `web` (Expo web is *not* a deliverable but should still boot — the dev
  CORS regex already allows localhost).
- `babel.config.js` + `metro.config.js` as the template ships them.
- `.env.example`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
  `EXPO_PUBLIC_API_URL` (e.g. `http://localhost:8000/api/v1` — Android
  emulator needs `10.0.2.2`, document it in README).
- `expo-dev-client` installed; README runbook for `eas build --profile
  development`.

### WP2 — Plumbing (`mobile/src/lib/`)

- `lib/supabase.js` — `createClient(url, anon, { auth: { storage:
  AsyncStorage, autoRefreshToken: true, persistSession: true,
  detectSessionInUrl: false } })` + `accessToken()` helper.
- `lib/api.js` — **1:1 port of `web/src/lib/api.js`**: same error shape,
  same header logic, same `{org}` per-call override, same `ORG_LOADING`
  guard, same timeout, same 401 handler hook.
- `lib/org.js` — `currentOrgId`/`setCurrentOrg`/`atLeast` backed by
  AsyncStorage (async getters — audit every call site; web's sync getter
  pattern does NOT carry over).
- `lib/auth.jsx` — `AuthProvider` (`session`, `loading`, `useAuth`)
  mirroring the web one, on `supabase.auth.onAuthStateChange`.
- `lib/rules.js` — **copy verbatim** from web + sync-warning comment.
- `lib/starterPack.js` — **copy verbatim** + same comment.
- `theme/` — token module: all four palettes from `index.css` as plain JS
  objects; `ThemeProvider` (default = system via `useColorScheme`, override
  persisted in AsyncStorage, same theme ids as web's THEMES); a
  `shadowBox(level)` helper for the offset-shadow look.

### WP3 — Design-system port (`mobile/src/components/ui.jsx`)

Native equivalents, same props shape where feasible:

- `Button` (primary/secondary/danger variants + press opacity),
  `Input`, `Select` (custom bottom-sheet picker — `<select>` doesn't
  exist), `Field`, `Card`, `Chip` (all 6 kinds), `Empty`, `ErrorState`,
  `HintBanner`, `Skeleton` (Animated pulse), `Avatar`, `PageHeader`,
  `Toast` (own lightweight implementation — no dep), `ThemePicker`,
  `BadgeCheck`-style icon usage via `lucide-react-native`.
- `Sheet` → `Modal` bottom sheet: backdrop tap closes, `maxHeight ~85%`
  with pinned title/X header + `ScrollView` body + safe-area padding.
  `ConfirmDialog` on top of it (incl. `requireText` type-to-confirm).
- `PhotoPicker` → `expo-image-picker` (camera + library, ≤3 photos,
  thumbnails, remove).

### WP4 — Auth, onboarding, shell

- `app/_layout.jsx` — providers (QueryClient, Theme, Toast, Auth) +
  `Stack`; auth gate: no session → `login`; session + zero memberships →
  `onboarding` (with the sign-out escape — same trap as web, don't skip
  it); else tabs. `/admin` reachable for org-less admins.
- `app/login.jsx` — email/password with in/up/forgot modes **and Google**:
  ```js
  const redirectTo = AuthSession.makeRedirectUri({ scheme: 'councilog', path: 'auth/callback' });
  const { data } = await supabase.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type === 'success') {
    const p = new URLSearchParams(new URL(res.url).hash.slice(1));
    await supabase.auth.setSession({
      access_token: p.get('access_token'), refresh_token: p.get('refresh_token') });
  }
  ```
  Supabase dashboard gets `councilog://**` + the auth.expo.io dev proxy in
  redirect URLs (documented in DEPLOY.md — WP11).
- `app/onboarding.jsx` — create-org vs join-with-code/request, org ID
  paste, sign-out footer (mirrors web).
- `app/(tabs)/_layout.jsx` — bottom tabs mirroring web `NAV` exactly:
  Today / Journal / Attendance / Projects + More sheet (Papers, Members,
  Guide, Settings-if-adviser+, Admin-if-platform-admin), org switcher,
  account row, theme picker, sign out. Same visibility rules
  (`admin` = adviser+, `platform` = `me.is_admin`).

### WP5 — Daily surfaces

- `app/(tabs)/index.jsx` Today: duty status, today's roster, unaccounted
  count, open deadlines — port `Dashboard.jsx` queries/cards.
- `app/(tabs)/journal.jsx`: day-grouped feed, compose = photo via camera/
  library + one line + optional project link, "no tasks" toggle. Photo
  flow = `POST …/journal/photos/sign` → PUT bytes → attach path — same as
  web; read `FileSystem`/blob carefully (RN `fetch` handles `file://`
  bodies).
- `app/(tabs)/attendance.jsx`: week grid + member filter + summary —
  read-mostly port; no-tasks declaration allowed.

### WP6 — Papers (`app/(tabs)/documents*` via More nav)

- List with status filter; detail = signatory steps + custody timeline.
- Register sheet: doc type, title, **linked-project picker**, flag
  checkboxes (vocabulary from `collectFlagNames`), live `ChainPreview` —
  ported.
- "Move paper" = **camera capture** by default (`launchCameraAsync`) —
  this is the mobile superpower; "Sign"/"Skip w/ reason" per step;
  revision rounds; attach-chain escape hatch; sign-all.
- Movement photos: `POST …/photos/sign` → PUT → record movement.

### WP7 — Projects

- Board by status; detail: dual checklists (paper/logistics), items
  check-off (officer+), "Generate checklist" + matched-template preview +
  force-pick append confirm (409 flow — port `ProjectDetail` logic),
  create/edit sheets with flag checkboxes + `ChecklistPreview`.

### WP8 — Members, Guide, library

- Roster + org chart tabs; role select + remove (owner) with the
  sole-owner 409 surfaced verbatim in a toast.
- Guide: all sections incl. the starter library — browse for all members,
  "Add to my org" for owners, same idempotent install + `why` notes.
  `starterPack.js` is already copied (WP2) — this WP is UI only.

### WP9 — Settings, Account, Admin

- Settings: all 8 tabs — members/positions/duty/templates/chains/contacts/
  invites/audit — plus the Danger zone "Archive org" (type-the-name
  confirm → clears org → lands onboarding). TemplateEditor and
  ChainEditor port to native row editors — every field, dropdown
  conditions (never raw JSON), reorder, delete with the snapshot warning.
- Account: identity (avatar upload via the same sign→PUT→PATCH), per-org
  capabilities, "CounciLog admin" line when `me.is_admin`, security
  (password change), theme, danger zone (sign out, delete account incl.
  SOLE_OWNER 409 handling).
- Admin (`/admin`): orgs list incl. archived badge, expand → roster +
  remove, archive/restore — calls `/admin/orgs`, `/orgs/{id}/members` and
  archive endpoints with `{org}` override (the bypass handles headers).

### WP10 — Landing page `v2/landing/`

Standalone static site — `index.html` + `styles.css` + `links.js`. No
framework, no build step, no auth.

- Hero: name + the one-liner from web login ("Council ops: duty, journal,
  papers — logged with proof."), one-line elaboration from PRODUCT.md's
  positioning (attendance = documented work, not clocks).
- **Two equal CTAs**, side by side on desktop / stacked on mobile:
  "Use the web app" → `LINKS.webapp`; "Get the app" → `LINKS.android` /
  `LINKS.ios` (platform-detected primary, both listed). If an app link is
  empty, show "Coming soon" — never a dead button.
- `links.js` — `window.COUNCILOG_LINKS = { webapp: '…', android: '…',
  ios: '…' }` at top of body so a deploy edit touches one file.
- A 3–4 item feature strip (Duty that's real work · Photo journal · Paper
  trails with custody · Checklists that build themselves) + a short
  "one login works everywhere" line + minimal footer. Brutalist styling:
  thick `2px` borders, hard offset shadows, accent `#f4be04`, generous
  type — pull palette values from `index.css`.
- Responsive, dark-friendly (`prefers-color-scheme`), no trackers.

### WP11 — Docs

- `v2/DEPLOY.md`: 3-piece diagram → 5-piece (`web`, `api`, `mobile` via
  EAS, `landing` static, Supabase); new Part — Supabase redirect URLs
  (`councilog://**`, dev proxy); EAS build notes (`eas build --profile
  development` for dev devices, `--profile production` for stores);
  landing = third Vercel project, root `v2/landing`, framework "Other",
  no build command; update the post-deploy checklist (mobile sign-in,
  camera journal, deep link).
- `v2/spec.md`: §1 platform line (web **and** app), §6 screen inventory —
  app routes mirror the table.
- `v2/PRODUCT.md`: stack line — mobile moves from "later phase" to
  shipped (`React Native/Expo at v2/mobile, same API contract`).
- `v2/mobile/README.md`: env setup, dev-client build runbook, the
  `10.0.2.2` Android emulator note, the `rules.js`/`starterPack.js`
  sync-responsibility warning, and "the API never changes for mobile —
  web parity is the spec".

### WP12 — Verification

Build the per-screen parity matrix into your report: for every web page,
the app equivalent with "done/quirk" notes (e.g., Select → bottom-sheet
picker). Then:

- `cd v2/api && pytest` — **still green, unmodified** (proof of the
  zero-API constraint).
- `cd v2/web && npm run build` — still green.
- `cd v2/mobile && npx expo start` boots; sign-in (email + Google) works
  on a dev build; journal photo uploads; a paper move with camera posts
  and shows on web.

---

## §4 Acceptance criteria — the pass/fail list

- [ ] Same account signs into web and app; same orgs/data appear — one
      Supabase project, zero API changes (diff on `v2/api/` is empty).
- [ ] Email **and** Google sign-in work on a dev build (`councilog://`
      callback); org-less users land on onboarding with a visible sign-out.
- [ ] All web surfaces exist natively: Today, Journal (camera), Attendance,
      Projects+detail, Papers+timeline+move/sign/skip/revise/attach,
      Members+chart, Guide+library install, Settings all tabs + archive,
      Account incl. delete-account, Admin for platform admins.
- [ ] Photo flows round-trip: journal entry + paper movement photos taken
      on the phone render on the web app (signed URLs work).
- [ ] Sheets cap at ~85% viewport with scrollable bodies; forms keyboard-
      safe; all four themes port; no literal hex in components.
- [ ] `include_if_flag`, event-type conditions, due-day rules, snapshot
      warnings, the 409 idempotency confirm — all behave identically.
- [ ] `v2/landing/` serves standalone; CTAs route to web + app; missing
      store links degrade to "Coming soon".
- [ ] `pytest` + `npm run build` pass; DEPLOY.md lets someone ship all
      five pieces; no secrets, no tool attribution.

---

## §5 Verification sequence

1. `cd v2/api && .venv/Scripts/python -m pytest -q` — unchanged, green.
2. `cd v2/web && npm run build` — unchanged, green.
3. Mobile manual run on a dev build: sign in (both methods) → onboarding
   → journal with camera photo → move a paper → check a checklist →
   view roster → browse Guide → owner installs a library entry → confirm
   it shows on web Settings.
4. `cd v2/landing && npx serve .` (or just open the file) — both CTAs
   resolve; responsive at 360px + 1280px; dark mode respected.
5. If `impeccable` is installed: `impeccable detect --json` on the landing
   files; fix real findings, skip noise contradicting §2.

---

## §6 Out of scope

Push notifications, offline queue/sync (web isn't offline either —
pull-to-refresh suffices), App Store / Play Console submission metadata and
actual store listing (links.js ships empty → "Coming soon"), Expo web
build as a *supported* surface (it must boot, it's not the deliverable —
browsers use `v2/web`), iPad/tablet layouts, in-app admin management of
`is_admin` (stays SQL), biometric/PIN lock, per-office auth, template
versioning, deep links into specific app screens beyond auth callback.
Note deliberately-deferred ideas in a short "future polish" section of
your report — don't sneak them in.

## Output format

1. Ordered list of files changed/created with a one-line "why" each.
2. The WP-by-WP landing order you used and why (must keep app runnable).
3. Per-screen parity matrix: web route → app route → status/quirk.
4. Verification output: pytest tail, web build tail, mobile smoke notes,
   landing check.
5. Deviations from this prompt, each with the reason.
6. "Future polish" — deliberately deferred items.
