# SWE-2 Max Prompt — CounciLog: load speed, render perf, caching, offline-test coverage

You are a senior product engineer. The CounciLog ecosystem is live and
feature-complete enough to pilot: FastAPI on Vercel (`v2/api`), React+Vite
web (`v2/web`), Expo app (`v2/mobile`). Now it needs to feel **fast** on a
mid-tier Android phone on school wifi, and the offline engine we just
shipped needs a real test protocol.

Your mission, six work packages plus tests:

1. **Web first load** — `src/main.jsx` eagerly imports all 19 pages and
   every dependency. The entry chunk is ~661KB minified and Vite already
   warns >500kB. A member on the login screen downloads the Admin page.
   Split it.
2. **Web data layer** — `new QueryClient()` is bare: zero `staleTime`,
   default `refetchOnWindowFocus`. Every tab focus and mount hammers a
   serverless API with cold-start latency. Tune it.
3. **API responses** — no `Cache-Control` anywhere, and no audit has been
   done on list-endpoint payload size/N+1/pagination. Vercel cold starts
   make every miss expensive.
4. **Mobile render perf** — the app ships **zero FlatLists**: journal,
   tasks, documents, members, agenda all `.map()` inside `ScrollView`.
   Every row, photo thumb, and action mounts eagerly. Photo lists load
   full-resolution images.
5. **PWA shell caching** — repeat web visits re-download the whole app.
   Cache the static shell only; API data stays live.
6. **Offline test coverage + playbook** — `src/lib/offline/outbox.js` has
   `node --test` coverage, but `store.js` (the SQLite layer) is untested
   and there is no written device-testing protocol for the offline flows
   we're about to demo to a real council.

**Measure first, then change.** Every work package ends with a number —
before/after bundle sizes, Lighthouse scores, p95, rows-rendered counts.
A perf change without a measurement is a guess. The spec's bar is §927:
p95 API reads < 500ms; dashboard LCP < 2.5s on a mid-tier phone.

---

## §1 Read before you touch anything

1. `v2/web/src/main.jsx` — the route table (~lines 13–31 imports,
   ~52–68 Routes) is the splitting surface. `qc = new QueryClient()` ~41
   is the data-layer surface.
2. `v2/web/vite.config.js` — bare: `react()` + `tailwindcss()` only.
   `manualChunks` goes here.
3. `v2/web/index.html` — head has `theme-init.js` (must stay first —
   it's the anti-FOUC theme setter) and nothing else: no preconnect, no
   manifest, no favicon link.
4. `v2/web/vercel.json` — already sets `Cache-Control: immutable` on
   `/assets/` (hashed files) and a strict CSP: `script-src 'self'`,
   `connect-src 'self' https://*.supabase.co wss://*.supabase.co
   https://*.vercel.app https://accounts.google.com/gsi/`. Any service
   worker must satisfy this CSP — `worker-src` falls back to
   `script-src 'self'`, so a `/sw.js` from the same origin is legal.
5. `v2/web/src/components/ui.jsx` — the Skeleton/PageSkeleton pieces are
   the Suspense fallbacks; reuse, don't invent a second loading visual.
6. `v2/web/src/components/ChainFlow.jsx` (~33) and `Journal.jsx` — the
   `<img>` render sites for signed-URL photos.
7. `v2/api/app/main.py` + `v2/api/app/routers/*` — middleware stack and
   response construction; no cache headers exist today.
8. `v2/mobile/src/components/ui.jsx` — `Screen` wraps content in a
   ScrollView. A FlatList inside it nests scroll contexts — the screens
   you convert may need a `scroll={false}` variant or a different page
   shell. Study this before converting lists.
9. `v2/mobile/app/(tabs)/journal.jsx` (~213) — by-day `.map()` groups
   with `PhotoThumb` per photo: the heaviest render site.
10. `v2/mobile/src/lib/offline/` — `outbox.js` (pure engine, tested),
    `store.js` (expo-sqlite persistence, untested), `index.js`
    (integration), `outbox.test.js` (`node --test`, in-memory store).
11. `v2/mobile/src/lib/connectivity.js` — NetInfo→onlineManager bridge;
    queries pause offline (`fetchStatus: 'paused'`) and `replayQueue`
    fires on reconnect. The playbook must exercise this exact path.
12. `v2/mobile/app/pending.jsx` — the outbox UI (retry/discard). The
    playbook's dead-letter section tests against this screen.
13. `v2/mobile/eas.json` — `preview` profile bakes prod env; the local
    `mobile/.env` holds the **dev LAN IP**. Any `eas update` run without
    env isolation will brick installed devices — see footguns.
14. `v2/web/e2e/` + `playwright.config.js` — Playwright infra exists;
    perf-budget assertions slot in here rather than a new harness.
15. `AGENTS.md` UX rules — plain language, never a silent no-op, every
    automated behavior must be visible/explainable in the UI (this
    applies to the SW update toast in WP5).

## The footguns — learn from what already bit us

- **`mobile/.env` has the LAN IP.** `EXPO_PUBLIC_API_URL` locally is
  `http://192.168.254.158:8000/api/v1`. `eas update` bundles with local
  env → shipping an OTA update from this tree without env isolation
  silently points every installed app at a dead address. Any offline or
  update command must use `--environment preview` or explicit prod env.
- **Lazy routes break preloaded state.** Several pages depend on org
  context hydrated in `AppShell`/route order. Lazy-load pages, not the
  providers (`AuthProvider`, `ThemeProvider`, `ToastProvider`,
  `setCurrentOrg` wiring) — those stay in the entry chunk.
- **staleTime masks freshness-critical queries.** The "Needs you" card,
  notifications badge, and outbox-adjacent reads must stay fresh. Set
  safe defaults globally, then override per-query where staleness is a
  product bug, not a perf win.
- **Nested VirtualizedList warnings.** `Screen` is a ScrollView —
  `FlatList` inside it warns and misbehaves. Screens becoming list-driven
  need the non-scroll shell; do not wrap FlatList in ScrollView "to keep
  padding."
- **SW + auth tokens = staleness/security.** Never cache
  `Authorization`-bearing requests, Supabase REST, or the API origin —
  the SW's fetch handler must pass those through untouched. Precache
  only `/`, `index.html`, `/assets/*` (hashed), icons, fonts.
- **Silent SW updates strand users on old code.** Use prompt-style
  updates: a toast "New version ready — reload" that the user taps. Never
  `skipWaiting` + force-reload mid-typing (journal drafts live in memory).
- **`expo-image` is a native module.** Adding it improves image caching
  but the change can NOT ship via `eas update` — it needs a new native
  build. Either gate WP4's image work on a coordinated rebuild, or use
  RN `Image` with sized thumbnails. Say in the PR which you chose.
- **node --test can't import expo-sqlite.** `store.js` imports native
  code. Test through a seam: dependency-inject the db handle, or write
  the store so its SQLite calls are a thin adapter over an injectable
  executor — then cover it with an in-memory/`node:sqlite` fake.
- **Photo byte size on unauthenticated view.** Vercel serverless + signed
  Supabase URLs: thumbnails in lists must not request the original
  full-res object just to render a row.
- **Don't pessimize the offline queue for speed.** `client_request_id`
  dedupe and `photo_record` composite ops are correctness-critical; a
  "batching optimization" that reorders or merges them is a data bug.

---

## §2 Hard constraints — violations are regressions

- **Measure before and after.** Every WP lands with a numbers table:
  `vite build` chunk sizes, Lighthouse mobile score on `/login` +
  `/` (dashboard), API p95 for the 3 hottest reads, rows mounted for the
  converted lists.
- **Budgets** (fail the PR if exceeded without justification):
  - web entry chunk ≤ ~250KB gzip; no single async chunk >500KB;
  - Lighthouse mobile performance ≥ 90 on login + dashboard;
  - p95 API reads < 500ms (spec §927);
  - dashboard LCP < 2.5s mid-tier (spec §927).
- **Zero behavior change.** Same screens, same data, same permissions,
  same offline semantics. Perf is invisible or it's a bug.
- **Additive config only.** `vercel.json` headers may add, never weaken
  CSP/security headers. `eas.json`/`app.json` env stays prod-pinned.
- **No new runtime deps without justification.** `vite-plugin-pwa` is
  build-time — acceptable. Anything client-bundle needs a line in the
  PR explaining why a hand-rolled solution was wrong.
- **Existing tests stay green:** `pytest` (86), `vite build`,
  `expo lint`, `expo export`, `node --test src/lib/offline/`, Playwright
  e2e.
- **Design language stays brutalist** — the update toast, skeletons,
  and any new loading UI use existing tokens/components.
- **Plain JS/JSX.** No secrets, no tool attribution, no comments unless
  the file's style already has them.

---

## §3 Work packages

Order: measure first (WP0), then API cache (WP3) → web split (WP1) →
web data (WP2) → mobile render (WP4) → PWA (WP5) → offline tests (WP6).

### WP0 — Baseline measurement (do not skip)

Before touching code, record:
- `vite build` output: chunk table, entry size, warnings.
- Lighthouse mobile score (throttled) on `/login`, `/` (dashboard),
  `/projects`, `/journal` — screenshot the four.
- API p95 for the 3–5 hottest reads (members list, projects list,
  documents list, journal list, notifications) — read Vercel function
  logs or add `X-Response-Time` temporarily.
- Mobile: journal render — how many `PhotoThumb`s and rows mount for a
  50-entry journal? Note it.

This is the comparison table the PR must fill.

### WP1 — Web code splitting (`web/src/main.jsx`, `vite.config.js`, `index.html`)

- `React.lazy` + `Suspense` for every route page **except** the auth
  entry path (`Login`, `AuthCallback`, `ResetPassword`, `Onboarding`)
  and `AppShell` — those stay eager; they're what every first visit hits.
- Fallback = existing full-page `Skeleton` (from `ui.jsx`), not a blank
  screen.
- `manualChunks`: split `react`+`react-dom`+`react-router-dom`,
  `@tanstack/react-query`, `@supabase/*`, `lucide-react` into named
  vendor chunks — they cache across deploys while app code changes.
- `index.html` head additions (keep `theme-init.js` first):
  - `<link rel="preconnect" href="https://<project>.supabase.co">`
  - `<link rel="preconnect" href="https://<api>.vercel.app">`
  - `<link rel="dns-prefetch">` for both
  - favicon link, `<meta name="theme-color">` (match `#27146e` splash),
    `<link rel="manifest">` pointing at WP5's manifest.
- Report: entry chunk before/after, total async chunks, the biggest
  page chunk.

### WP2 — Web query + image tuning (`lib/query defaults`, pages)

- `QueryClient` defaults worth tuning (justify each in the PR):
  - `staleTime`: 30–60s for lists; keep 0 or low for notifications /
    needs-you / anything the outbox or badge depends on.
  - `gcTime`: ~5min (default is fine, say so if kept).
  - `refetchOnWindowFocus`: false globally **or** keep true only on
    freshness-critical queries — pick one policy, explain it.
  - `refetchOnMount`: `'if-stale'`-equivalent behavior via staleTime.
- Photo `<img>` sites (`ChainFlow` step photos, journal thumbs, avatars
  in member lists): `loading="lazy"` `decoding="async"` + a sized
  thumbnail request where the storage path allows it — do not 404 if
  the object only exists at full size.
- Audit pages that fetch-then-render whole lists (Members, Projects,
  Documents, Tasks, Agenda, Attendance): are list endpoints bounded?
  If a page requests `?limit=` it doesn't honor, or renders 200 rows
  unfiltered, file it under WP2 findings.

### WP3 — API caching & slimming (`api/app`)

- Add `Cache-Control` to **read endpoints** only, scoped:
  - near-static org config (positions, duty schedules, chains,
    templates, contacts): `private, max-age=60, stale-while-revalidate=300`;
  - document/project lists: `private, max-age=15` or none — pick per
    freshness need and say why;
  - notifications/tasks: no cache (freshness-critical);
  - every mutation: unchanged.
  - `private` not `public` — org data must never sit in a shared cache.
- Consider ETag on the 2–3 largest list responses if cheap (hash of a
  materialized column — `max(updated_at)` + count, not body hashing).
- Audit the list endpoints: unbounded `select()`s, N+1 on
  `document_signatory_steps`/`checklist_items` loads, missing
  `limit`/`offset` where the UI paginates visually. Fix with additive
  params; do not reshape responses.
- Cold start: confirm the Supabase/asyncpg pool and the Supabase auth
  client aren't being re-initialized per request; if they are, hoist.
- Report: which 3 reads dominate p95, and the header/param change for
  each.

### WP4 — Mobile render perf (`v2/mobile/app`, `src/components/ui.jsx`)

- Give `Screen` a non-scroll mode (or a sibling `ScreenList`) for
  FlatList-driven pages — killing nested VirtualizedList warnings.
- Convert, in priority order:
  1. `journal.jsx` — by-day groups → `SectionList` (day = section,
     entry = item); `PhotoThumb` lazy + sized.
  2. `tasks.jsx`, `documents.jsx` — `FlatList` with `keyExtractor`,
     `initialNumToRender` ~15, `windowSize` ~7.
  3. `project/[id].jsx` checklist — only if profiling shows jank; it's
     usually <50 rows.
- Skip conversion where a list is provably short (duty schedule rows,
  settings tabs) — justify in PR by row count.
- `React.memo` on list-row components where render counts show waste —
  profile first (React DevTools profiler / a render counter), don't
  blanket-memo.
- Images: prefer `expo-image` (`npx expo install`) **only if** a native
  rebuild is happening anyway; otherwise sized thumbs + RN `Image`.
  State the choice in the PR.
- Report: rows mounted before/after for journal @50 entries; scroll-FPS
  note on a mid-tier device class (Android ~Pixel 6a) if measurable.

### WP5 — PWA shell caching (`web/`, `vite.config.js`, `public/`)

- `vite-plugin-pwa` (build-time dep) with `registerType: 'prompt'`:
  - precache: `index.html`, hashed `/assets/*`, icons, `theme-init.js`;
  - runtime: **navigation → NetworkFirst** falling back to cached
    `index.html` (fresh shell on new deploys, offline open still works);
  - **API/Supabase/auth: never cached** — the fetch handler must pass
    those through (list the host allowlist in the SW config comment or
    docs).
- `manifest.webmanifest` — name, `theme_color`/`background_color` =
  `#27146e`, icons (reuse the branded set from `mobile/assets/` or
  regenerate at 192/512; do not ship the default Vite icon), display:
  `standalone`.
- Update UX: on `needRefresh` → toast "New version ready — Reload?" with
  the existing Toast/Button components. No auto-reload.
- Dev safety: SW registers only in `import.meta.env.PROD`; unregister on
  dev so hot reload isn't served stale assets.
- Verify in the PR: `npx vite build && npx vite preview` → DevTools →
  Application shows SW active; second load of `/` paints from cache
  (Lighthouse "PWA" or manual check); offline reload of `/` still renders
  the shell.

### WP6 — Offline test coverage + playbook (`mobile/`)

- Extend `node --test` to `store.js` via a seam — inject the db handle
  or adapt `expo-sqlite`'s calls to `node:sqlite` (Node 22+). Cover:
  - enqueue→pending→sent and →dead transitions persist across a
    simulated restart (close + reopen store),
  - `client_request_id` dedupe: replaying the same op twice yields one
    row on the server side of the fake sender,
  - `photo_record` composite ordering (upload before record POST),
  - `references()` guards: can't discard an op another op depends on.
- Wire `"test": "node --test src/lib/offline/"` into
  `mobile/package.json`; add it to CI (`ci.yml`) beside `expo lint`.
- Write `v2/mobile/OFFLINE_TESTING.md` — the device playbook:
  - **Setup**: preview APK installed, signed in, queue empty
    (`/pending` shows nothing).
  - **Matrix** — every writable flow × {offline-then-online}:
    journal entry, journal entry + photo, paper movement + photo, task
    create, task comment, checklist toggle, document create/sign.
    For each: expected `SyncBanner` copy → `/pending` row label →
    post-reconnect server state (verify on web).
  - **Dedupe proof**: submit, toggle airplane mid-flight so the POST
    lands but the ack times out, retry → one row, not two.
  - **Dead-letter**: force a failing op (e.g. stale org after being
    removed) → lands in `/pending` as failed → retry/discard both work.
  - **Pause-vs-error**: while offline, queries show `paused`/cached
    last-known data, not error cards — screenshot expected state.
  - Each step lists what "pass" looks like and where the state lives
    (banner, `/pending`, web UI).

### WP7 — Docs

- `spec.md` §927-area: record the measured budgets + which are enforced
  in CI (bundle-size check, Lighthouse CI if added).
- `DEPLOY.md` launch checklist: "run the offline playbook once on the
  preview APK before pilot" — link the new doc.
- `USER_GUIDE.md`: the "New version ready" toast and what "work
  offline" means on web (shell only — reads cached shell, writes need
  signal; keep it one plain-language paragraph).

---

## §4 Acceptance criteria — the pass/fail list

- [ ] `vite build` chunk table before/after pasted in the PR; entry
  ≤ ~250KB gzip, no async chunk >500KB.
- [ ] Lighthouse mobile: ≥90 performance on `/login` and `/`; LCP
  <2.5s.
- [ ] `main.jsx` lazy-loads every non-auth page; suspense fallback is
  the existing Skeleton; auth redirect + org preload unbroken.
- [ ] `QueryClient` has explicit defaults + a comment/doc saying why;
  notifications & needs-you still fresh.
- [ ] The 3 hottest API reads carry cache headers chosen per-freshness,
  all `private`; writes uncached; a short rationale in the PR.
- [ ] No page requests unbounded lists it can't render; N+1 hotspots
  named and fixed or flagged.
- [ ] `journal.jsx`, `tasks.jsx`, `documents.jsx` use FlatList/
  SectionList (or a justified skip); zero nested-VirtualizedList
  warnings; `PhotoThumb` doesn't fetch full-res.
- [ ] SW active in prod build only; API/Supabase/auth responses never
  cached; update toast appears on new deploy; offline reload of `/`
  still renders the shell; `manifest.webmanifest` + branded icons ship.
- [ ] `node --test` covers `store.js` persistence/dedupe/composite-
  ordering; `mobile/package.json` has a `test` script; CI runs it.
- [ ] `v2/mobile/OFFLINE_TESTING.md` exists and covers the full
  writable-flow matrix + dedupe + dead-letter + paused-query states.
- [ ] All existing tests green; no new runtime deps without a PR
  rationale line.

## §5 Verification sequence

1. `cd v2/api && .venv/Scripts/python.exe -m pytest` — 86 green.
2. `cd v2/web && npx vite build` — clean, chunk table recorded.
3. `cd v2/web && npx vite preview` + Lighthouse on the built bundle
   (not dev server).
4. `cd v2/mobile && npx expo lint` — 0 problems.
5. `cd v2/mobile && npx node --test src/lib/offline/` — new coverage
   green.
6. `cd v2/mobile && npx expo export --platform android --output-dir
   dist-check` — bundle resolves; delete `dist-check` after.
7. Manual: `vite preview` → DevTools → Application → SW active →
   offline reload renders shell.
8. Manual: run the OFFLINE_TESTING.md matrix on the preview APK, first
   pass end-to-end.
9. `git diff` review — additive-only confirmed.

## §6 Out of scope

- No migration off Vercel, no edge-runtime rewrite, no SSR.
- No API pagination-contract redesign (additive `limit`/`offset` only).
- No image-CDN/transform pipeline (Supabase transforms are a paid tier —
  flag it in findings if it would win).
- No offline *writes* on web — shell caching only.
- No `expo-image` (or any native dep) without a coordinated rebuild —
  document if chosen.
- No redesign of the outbox state machine — it's the tested correctness
  core.
- No bundle-analyzer UI tooling left as a runtime dependency.

## Output format

A single PR. Order commits: WP0 baseline numbers → WP3 API → WP1/WP2
web → WP4 mobile → WP5 PWA → WP6 tests+docs → WP7. The PR body carries
the before/after numbers table and the executed offline-playbook
checklist. Name any measurement you couldn't take and why.
