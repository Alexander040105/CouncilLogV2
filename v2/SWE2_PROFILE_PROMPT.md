# SWE-2 Max Prompt — CounciLog: Account profile & settings page

You are a senior product engineer. CounciLog's MVP is functionally complete
(duty/attendance, journals, projects, papers, org admin) — but there is **no
place for a user to manage their own account**. Profiles are created lazily
with `display_name = email`, `avatar_url` is never settable, there's no
password/email control in the UI, and no account deletion path.

Your mission: build a **per-account profile & settings page** — own-account
only — covering identity (display name + avatar), a "what you can do"
capabilities view, security controls (password, email), preferences (theme),
sign-out, and account deletion. This requires both **web** and **API** work —
unlike earlier web-only passes, `v2/api/` and `v2/supabase/migrations/` are in
scope.

Work at the repo root (`CouncilLogV2/`). App code lives in `v2/web/` +
`v2/api/` + `v2/supabase/migrations/`.

---

## §1 Read before you touch anything

1. `v2/PRODUCT.md` — audience and tone (Operate-mode tool for student
   officers on phones).
2. `v2/DESIGN.md` — tokens, primitives, layout rules. Source of truth.
3. `v2/spec.md` — §3 features, §4 data model, §5 API inventory, §8 security.
4. `v2/ROLES.md` — the four-role permission model the capabilities card
   surfaces.
5. `v2/USER_GUIDE.md` — feature reference; you'll add a row.
6. All of `v2/web/src/` — especially:
   - `lib/auth.jsx` (session context), `lib/api.js` (`get/post/patch`,
     `ApiError` envelope), `lib/org.js` (`currentOrgId`, `ROLE_RANK`,
     `atLeast`), `lib/theme.jsx`, `lib/toast.jsx`
   - `components/AppShell.jsx` — sidebar footer avatar + sign-out, mobile
     More sheet (your entry point lives here)
   - `components/ui.jsx` — `Avatar`, `Card`, `Field`, `Input`, `Button`,
     `Sheet`, `Chip`, `ConfirmDialog`, `PageHeader`, `Empty`, `Skeleton`,
     `HintBanner`
   - `components/PhotoPicker.jsx` — capture-or-upload picker with `max` prop;
     **reuse it for the avatar** (`max={1}`)
   - `pages/Onboarding.jsx` — profiles are born here (see §3 WP4 edge cases)
7. `v2/api/app/routers/core.py` (`GET /me`), `orgs.py` (lazy Profile
   creation — copy that pattern), `deps.py` (`authorize`, `CurrentUser`),
   `errors.py` (`APIError` envelope), `services/storage.py`
   (`validate_upload_declared`, `signed_upload_url`, `signed_download_url`,
   `object_head`, `_headers/_base`), `services/audit.py`, `security.py`
   (`AuthUser`), `models.py` (`Profile`), `config.py`.
8. `v2/supabase/migrations/0001_init.sql` — the FK graph that constrains
   deletion (§3 WP1 explains why this matters).
9. If the `impeccable` skill is installed: run
   `impeccable context --target v2/web` once at session start, and read
   `reference/craft-floor.md` before your first UI edit. If not installed,
   skip silently.

---

## §2 Hard constraints — violations are regressions

- **Plain JavaScript/JSX.** No TypeScript, no `.ts`/`.tsx`, no `typescript`/
  `@types/*` deps. The maintainer only knows JS.
- **No new dependencies.** Everything needed already exists (lucide-react,
  PhotoPicker, ui primitives, supabase-js).
- **Tailwind v4 token architecture.** Only `var(--color-*)` — no literal hex
  in components, no `bg-white`/`text-black`.
- **Dark-first, both themes must pass.** WCAG AA in dark AND light; ≥44px
  touch targets; usable at 360px.
- **Operate mode.** Scanability > expression; no decoration for its own sake.
- **`PATCH /me` is an allowlist.** Only `display_name` and `avatar_url` may
  be writable through it — **never** `role`, `status`, `org_id`, or anything
  membership-shaped. A request containing extra writable-looking fields must
  not silently grant them (reject unknown keys or ignore them explicitly —
  pick one, document it, test it).
- **Thin client.** The web app may call `supabase.auth.*` (identity is
  Supabase's domain) but all table reads/writes go through FastAPI. Profile
  writes → `PATCH /me`, not direct `profiles` updates from the client.
- **No secrets.** Never read `.env`; service-role key stays server-side.
- **Don't regress:** Login bound auth calls (`supabase.auth.signIn…`, never
  extracted bare fns); AppShell org-less→`/onboarding` redirect; journal
  `?compose=1`/`?notasks=1` deep-links; `['me']` invalidation pattern;
  `enabled: !!org` guards on org-scoped queries.
- **No AI/tool attribution** anywhere (per repo `AGENTS.md`).

---

## §3 Work packages

### WP1 — API: self-service profile surface

All in `v2/api/app/routers/core.py` (keep it in core — these are
account-level, not org-scoped — so **no `authorize()` org dependency**; auth
only via `CurrentUser`).

1. **`PATCH /me`** — body `{display_name?, avatar_url?}`.
   - `display_name`: trimmed, 1–80 chars.
   - `avatar_url`: must be `None` (clears it) or a URL under the public
     avatars bucket path (see #3) — reject anything else with `422`.
   - **Upsert**: if no `profiles` row exists yet (user registered but never
     joined an org), create it — mirror the lazy-create pattern in
     `orgs.py` (`Profile(id=uid, display_name=...)`).
   - Returns `{data: profile}`.
   - Audit `profile.updated` with changed field names in metadata
     (audit rows need an `org_id` — audit under each of the user's orgs, or
     if that's awkward, once under the active org; document your choice).
2. **`POST /me/avatar/sign`** — body `{mime, byte_size}` →
   `validate_upload_declared` (jpeg/png/webp ≤5MB) → signed upload URL for
   path `avatars/{user_id}/{new_uuid}` → return `{upload_url, path}`.
   Client PUTs bytes then calls `PATCH /me` with the resulting public URL.
   On successful avatar change, best-effort **delete the previous avatar
   object** (path derivable from old `avatar_url`); failure to delete is a
   warning, not an error.
3. **`avatars` storage bucket** — new migration
   `v2/supabase/migrations/0002_avatars_bucket.sql`:
   `insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)`
   plus a public-read policy on `storage.objects` for that bucket. Public
   read is deliberate: `avatar_url` renders as a plain `<img src>` inside
   member lists/rosters where per-image signed URLs don't fit — avatars are
   LOW sensitivity (visible to all org members anyway). Note this tradeoff
   in the migration's comment and your report.
   - Reuse `services/storage.py` helpers; the bucket name for avatars may
     need a new env var or a constant — keep `STORAGE_BUCKET` meaning
     "journal bucket" and add `AVATARS_BUCKET` (default `avatars`).
   - `v2/README.md` gets a line in the Supabase setup steps.
4. **`DELETE /me` — anonymize + soft-remove + ban. Do NOT hard-delete the
   auth user.** This is a correctness requirement, not a style choice:
   `profiles.id` references `auth.users(id) on delete cascade`, but
   `org_members.user_id` references `profiles(id)` with **no** cascade, and
   `journal_entries/attendance_days/duty_schedules/positions` carry
   composite FKs into `org_members(org_id, user_id)`. Hard-deleting the
   auth user cascades the profile away and violates those FKs — it fails.
   Spec instead:
   - If the user is the **sole `owner`** of any org → `409` with a clear
     message ("you own an org — delete it or hand off ownership first";
     ownership transfer is out of scope).
   - Else: set all their `org_members.status='removed'`; anonymize the
     profile (`display_name='Former member'`, `avatar_url=null`, delete
     avatar object); then **ban** the auth user via Supabase admin REST —
     `PUT {SUPABASE_URL}/auth/v1/admin/users/{uid}` with service key,
     `{"ban_duration": "876600h"}` (~100 years ≈ permanent, still
     admin-reversible). Audit `account.deleted`.
   - This preserves journal/attendance/audit history (append-only model,
     spec §8.7) while ending access — removing the account without
     rewriting history.
   - Their `member_id` stays on historical rows, now pointing at an
     anonymized profile — acceptable and intended.
5. **Error envelope** — same `{error:{code,message,details?}}` shape
   everywhere via `APIError`; no internals leaked.

### WP2 — `/account` page

New `web/src/pages/Account.jsx`, route `/account` inside the `AppShell`
route group (NOT in the `NAV` array — it's account-level, not org-level).

Sections, top to bottom:

1. **Identity card** — large `Avatar` (reuse component; it may need a
   `size` prop — add it without breaking existing 7×7 usage), display name
   heading, email + "email verified/not verified" line if derivable from
   the session. **PhotoPicker `max={1}`** under the avatar ("Change photo",
   remove option). `display_name` `Field`+`Input` with a Save button;
   saving `PATCH /me` → toast → invalidate `['me']` **and** `['members']`
   (the roster renders your name/avatar).
2. **Capabilities card — "What you can do".** From `me.memberships[]` (ALL
   orgs, not just the active one): each org name + role `Chip` + the
   capability bullets for that role, from a static map in the file —
   content matching `ROLES.md`:
   - member: file journal entries, declare no-tasks, view shared surfaces
   - officer: member + register papers, log movements, sign/skip steps,
     check off checklist items
   - adviser: officer + create/edit projects, generate checklists, view audit
   - owner: adviser + manage members, invites, positions, duty, templates,
     chains, contacts
   Empty state if `memberships` is empty ("join an org to unlock…"). No API
   needed — derive, don't fetch.
3. **Security card** —
   - *Change password:* new + confirm fields, ≥8 chars, matching check;
     `supabase.auth.updateUser({ password })`; bound call on
     `supabase.auth`, `busy` resets in `finally`; success toast. (OAuth-only
     accounts: Supabase still accepts a password set — label the section
     "Set/change password" so it reads correctly either way.)
   - *Change email:* current email shown; new email `Input`;
     `supabase.auth.updateUser({ email })`; on success show a persistent
     note "confirmation sent to the new address — it applies once you
     confirm" (Supabase sends a confirm email; don't claim it's done).
4. **Preferences card** — `ThemeToggle` with a one-line description
   ("Dark is default; your choice sticks to this browser").
5. **Danger zone card** — visually quiet until interacted:
   - *Sign out* — `Button` secondary; same handler as AppShell
     (`supabase.auth.signOut()` + `setCurrentOrg(null)` → `/login`).
   - *Delete account* — danger `Button` → `ConfirmDialog` (danger variant)
     whose body requires typing the account email to enable confirm
     (extend `ConfirmDialog` with an optional `confirmText` prop, or a
     small inline input inside the dialog — your call, keep it simple);
     on confirm `DELETE /me` → toast → sign-out + `/login`. If the API
     returns the sole-owner 409, surface the message verbatim — do not
     swallow it.

Every mutation: toast or field-level error. Every query region: `Skeleton`.
Mobile: sections stack full-width; desktop may use a two-column grid for
Security+Preferences under a full-width Identity card.

### WP3 — Navigation wiring

- `main.jsx`: `<Route path="account" element={<Account />} />` inside the
  AppShell group.
- `AppShell.jsx` desktop sidebar footer: the avatar + display name becomes
  a `Link to="/account"` (keep the LogOut button as its own control).
  Same in the mobile More sheet.
- Do NOT add `/account` to `NAV` — it's reached via the avatar, and on a
  7-item nav it would crowd out org surfaces.

### WP4 — States & feedback

- Loading: skeleton shaped like the cards (avatar circle + line + button).
- Org-less user: page still renders (capabilities empty-state; security +
  preferences work; `['members']` invalidation is a no-op when no org).
- Profile row absent (possible before first org join): identity card works
  anyway — `PATCH /me` upserts; show email as the fallback name.
- `me` query error: existing `Empty`/`toast` patterns, no silent blank.

### WP5 — Tests

Extend `v2/api/tests/` (follow `smoke_e2e.py` conventions — plain urllib,
`check(name, cond, detail)`):

- `PATCH /me` sets display_name → `GET /orgs/{org}/members` reflects it.
- **Negative:** `PATCH /me` with `{"role": "owner"}` or `{"org_id": ...}`
  does NOT change membership — assert member role unchanged afterwards.
- `POST /me/avatar/sign` with `mime="application/x-msdownload"` → 422;
  valid jpeg → `{upload_url, path}` shape.
- `DELETE /me` for a sole owner → 409; for a plain member → their
  membership flips to `removed`, profile anonymized, and their token
  subsequently gets 401 (banned).

If the smoke harness can't reach a live API in your environment, still
write the tests and mark them "requires running stack" in your report —
don't silently skip them.

### WP6 — Docs sync

- `v2/spec.md`: add `PATCH /me`, `POST /me/avatar/sign`, `DELETE /me` to
  the §5 endpoint inventory; add `/account` to the screens table; note the
  anonymize+ban deletion semantics in §8.7.
- `v2/USER_GUIDE.md`: Part B table gains an **Account** row (purpose:
  "your name, photo, role powers, password/email, theme, sign out,
  delete account"; who: everyone).
- `v2/README.md`: Supabase setup gains "create/run the `avatars` bucket"
  step (it comes from migration 0002 — just note it's required).
- `v2/ROLES.md`: one line pointing at the account page as the place users
  see their own role capabilities.
- `v2/DESIGN.md`: only if you introduce a pattern it doesn't cover (e.g.,
  a typed-confirm dialog or a danger-zone card convention).

---

## §4 Acceptance criteria — the pass/fail list

- [ ] `cd v2/web && npm run build` passes.
- [ ] `cd v2/api && .venv/Scripts/python -m pytest tests -q` passes (or
      smoke additions present + flagged if no live stack).
- [ ] No `.ts`/`.tsx` under `v2/web/src/`; no new dependencies anywhere.
- [ ] No literal hex colors in components; AA contrast in both themes.
- [ ] `/account` reachable via avatar in sidebar AND mobile More sheet;
      not present in `NAV`.
- [ ] Display name edit → PATCH → roster/members list shows new name
      without reload.
- [ ] Avatar upload via PhotoPicker → `Avatar` renders the photo; replacing
      deletes the old object; clearing falls back to initials.
- [ ] Capabilities card lists every org membership with correct role and
      capability bullets; empty state for zero memberships.
- [ ] Password change: mismatch/too-short → field error; valid → success
      toast; email change → confirmation-notice shown, never claimed as
      done.
- [ ] Delete account: typed-confirm required; sole owner gets the 409
      message; member deletion removes access + anonymizes + ends the
      session; org data/history untouched.
- [ ] `PATCH /me` cannot change role/status/org — proven by test.
- [ ] Docs updated per WP6; no secrets, no tool attribution.

---

## §5 Verification sequence

1. `npm run build` (web) — must pass before claiming done.
2. `pytest`/`smoke_e2e` results or the flagged-tests note.
3. Manual smoke at 360px and 1280px, both themes: open `/account`, change
   name (see it change in Members), upload avatar, inspect capabilities,
   password change on a test account, delete-account flow on a throwaway
   account.
4. If `impeccable` is installed: `impeccable detect --json` on changed
   files; fix real findings, skip stylistic noise contradicting §2.

---

## §6 Out of scope

Public member profiles (viewing another member's page), org switching UI
changes, notification preferences, MFA, "leave org" (owner-controlled
removal stays the only path), ownership transfer (documented blocker in
the delete flow instead), account un-ban admin UI, avatar cropping/editing.

## Output format

1. Ordered list of files changed/created with a one-line "why" each.
2. Build + test output tails.
3. The §4 checklist with actual pass/fail results.
4. The avatar-public-bucket decision + audit-row org choice, noted.
5. Short future-polish notes.
