# Deploying CounciLog — step-by-step guide

You'll end up with **three pieces** talking to each other:

```
web/  → Vercel static site (Vite)        https://<web>.vercel.app   ← your frontend
api/  → Vercel Python functions          https://<api>.vercel.app   ← your backend
Supabase → login, database, file storage                          ← your data
```

Deploy the **API first** — the web app needs the API's URL at build time.

Before you start you need:

- [ ] A GitHub account with this repository pushed to it (Vercel deploys
      straight from git — see step 0).
- [ ] A free Vercel account (sign in with GitHub — easiest).
- [ ] Your existing Supabase project (already running — you just need the
      dashboard open for copying keys).
- [ ] ~30 minutes.

---

## Step 0 — Push the code

Everything fixed in the launch audit is **currently uncommitted**. Vercel
can only deploy what GitHub has, so first:

```bash
cd v2
git add -A
git commit -m "Launch hardening: rate limiting, security headers, auth/reset flow, pagination + attendance fixes, deploy config"
git push
```

(The log files and stray `.jfif` photo are staged for deletion — keep that.)

---

## Part 1 — Deploy the API (backend)

1. **vercel.com → Add New… → Project → Import** this repository.
2. In **Configure Project**:
   - **Root Directory**: `v2/api` (click *Edit* next to Root Directory).
   - **Framework Preset**: leave as **Other** — Vercel auto-detects the
     FastAPI app (`app = FastAPI()` in `app/main.py`).
   - Leave build/install commands **empty/default** — there is no build step;
     Vercel installs `requirements.txt` itself. (Do NOT add a
     `pyproject.toml` to `v2/api` — its presence makes Vercel switch to a
     `uv lock` build that requires a `[project]` table, and the deploy fails.)
3. **Environment Variables** — add each row below (mark them for
   *Production* and *Preview*). Copy values from your `.env` where present,
   otherwise grab them from Supabase (paths given):

| Var | Where to get it | Required |
|---|---|---|
| `SUPABASE_URL` | Supabase → Settings → API → *Project URL* | yes |
| `SUPABASE_ANON_KEY` | Settings → API → *anon public* key | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → *service_role* key. **Keep this out of the web project — it's admin-level.** | yes |
| `SUPABASE_JWT_SECRET` | Settings → API → *JWT Secret*. Leave empty if your project uses the newer asymmetric keys (JWKS is fetched automatically) | no |
| `DATABASE_URL` | Settings → Database → *Connection string → Transaction/Session pooler* — copy it, then change the driver to `postgresql+asyncpg://` (e.g. `postgresql+asyncpg://postgres.xxxx:password@aws-0-…pooler.supabase.com:6543/postgres`) | yes |
| `WEB_ORIGIN` | `https://<web>.vercel.app` — you won't know it until Part 2; put a placeholder now and fix it in Part 3 | yes |
| `APP_BASE_URL` | same placeholder — public web URL used in notification emails | no |
| `ENV` | `prod` — turns off `/docs` and `/openapi.json` in production | yes |
| `STORAGE_BUCKET` | `journal` | yes |
| `WEB_ORIGIN_EXTRA` | leave empty — extra CORS origins for previews if ever needed | no |
| `AVATARS_BUCKET` | default `avatars` — only set if you renamed the bucket | no |
| `ORG_TIMEZONE` | default `Asia/Manila` | no |
| `SIGNED_URL_TTL_SECONDS` | default `900` (15 min photo links) | no |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD` `MAIL_FROM` | app-side *notification* emails (project assignments). Optional; the app warns and skips email if unset | no |

4. **Deploy**. When it finishes, open `https://<api>.vercel.app/api/v1/health`
   — you should see `{"ok":true}`. Also confirm
   `https://<api>.vercel.app/api/v1/docs` returns **404** (docs disabled in
   prod — correct).

> Free-tier notes: the API "sleeps" when idle — the first request after a
> while takes a few seconds (cold start). This is normal. Also: the
> **pooler** connection string is mandatory — a direct database connection
> won't survive serverless scaling.

## Part 2 — Deploy the web app (frontend)

1. **Add New… → Project → Import** the **same repository again**.
2. In **Configure Project**:
   - **Root Directory**: `v2/web`.
   - **Framework Preset**: **Vite** — build `npm run build`, output `dist`
     (auto-filled).
3. Environment variables:

| Var | Value |
|---|---|
| `VITE_SUPABASE_URL` | same Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | same anon key (it's public by design — safe in the browser) |
| `VITE_API_URL` | `https://<api>.vercel.app/api/v1` — the API URL from Part 1, **with `/api/v1` at the end** |

4. **Deploy**. Note the URL — e.g. `https://councilog.vercel.app`.

The committed `web/vercel.json` already handles: page-refresh routing (SPA
fallback), security headers (CSP, HSTS, click-jacking protection), and
asset caching — nothing to configure.

## Part 3 — Point the API back at the web app

The API only accepts requests from the web app's URL (CORS).

1. Vercel → **API project** → Settings → Environment Variables.
2. Edit `WEB_ORIGIN` → `https://<web>.vercel.app` (the real URL from Part 2).
   Edit `APP_BASE_URL` to the same.
3. **Deployments** → ⋯ on the latest → **Redeploy** (env changes need a
   redeploy to take effect).

> If you later add a custom domain (e.g. `app.councilog.ph`), set
> `WEB_ORIGIN` to it — and add the domain to `connect-src` in
> `web/vercel.json` if the *API* also gets a custom domain.

---

## Part 4 — Supabase production settings (do these now)

### 4a. Database migrations

If this is the **same Supabase project** you've been developing against,
migrations `0001`–`0006` are already applied — skip. For a **fresh**
project: SQL Editor → run every file in `supabase/migrations/` in order.

### 4b. Auth redirect URLs — required for login + password reset

Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://<web>.vercel.app`
- **Redirect URLs** (add both):
  - `https://<web>.vercel.app/auth/callback`
  - `https://<web>.vercel.app/reset-password`

Without these, email-confirmation links and password-reset emails will
bounce users to the wrong place (or localhost).

### 4c. SMTP for auth emails — the #1 launch gotcha

Supabase's built-in email sender is heavily rate-limited and **not for
production** — signup confirmations and password resets will silently stop
arriving.

Supabase → **Authentication → SMTP Settings** → enable *Custom SMTP* and
enter your mail provider's credentials (Maileroo, Resend SMTP, SES,
Postmark — anything works). This is **separate** from the `SMTP_*` API
env vars in Part 1 (those are for assignment-notification emails; these
are for login/signup/reset emails).

### 4d. Google sign-in (optional)

Authentication → Providers → **Google** → enable → paste a Google OAuth
client id/secret from Google Cloud Console. Add
`https://<web>.vercel.app/auth/callback` to the Google client's redirect
URIs, and add Supabase's callback URL
(`https://<project>.supabase.co/auth/v1/callback`) there too. Skip this
and email/password still works.

### 4e. Storage check

Storage → confirm: `journal` bucket exists and is **private**, `avatars`
exists and is **public** (roster photos render as plain `<img>` — that's
intentional).

---

## Part 5 — Post-deploy test run (5 minutes, do all of it)

Open `https://<web>.vercel.app` and check off:

- [ ] Sign up a new account → **confirmation email arrives** → confirm → sign in
- [ ] Sign out → *Forgot password* → **reset email arrives** → new password works
- [ ] Create an organization → copy the invite code → a second account (incognito) redeems it → both see the roster
- [ ] Post a journal entry **with a photo** → the photo displays (signed URL)
- [ ] Register a document → a signatory chain attaches automatically → sign a step
- [ ] File attendance on a day with no tasks → "no tasks" entry appears
- [ ] Sign out → visit `/documents` directly → bounced to `/login`
- [ ] Open on your phone (or browser at 360px) → bottom nav, no sideways scroll

If any email step fails → Part 4c. If everything fails with CORS errors →
Part 3 (`WEB_ORIGIN` typo or missing redeploy).

---

## Part 6 — After launch

**Everyday deploys:** `git push` → Vercel rebuilds automatically. Web and
API deploy independently; a push only redeploys the project whose root
directory changed (enable *only build on changes* is on by default per
root directory).

**New database changes:** add a `supabase/migrations/0007_*.sql` file and
run it in the SQL Editor **before or with** the deploy. Migrations stay
additive (new columns/tables) so old code keeps working — that makes
rollback safe.

**Rollback:** Vercel → Deployments → ⋯ → *Instant Rollback* — per project,
instant, no rebuild.

**Preview deployments:** every PR gets a preview URL for the web app, but
it can't call the API (CORS) unless its origin is in `WEB_ORIGIN_EXTRA`.
That's deliberate — `*.vercel.app` CORS would let any Vercel site call
your API. Treat previews as visual-only, or point them at a dev API.

**Watch in the first week:**

- **Vercel → Logs** on the API project: `500`s need attention; `429`s mean
  rate limiting is working; a wall of `401`s means a token/expiry problem.
- **Supabase → Logs → Auth**: signup/reset failures almost always mean the
  SMTP config (4c) isn't working.
- **Supabase → Advisors**: rerun the security/performance advisors after
  any new migration.
- **Table Editor → `audit_log`**: should grow with real usage — it's the
  trail proving who did what.

**Rate limits now in force:** join requests 10/15 min, invite redeem
20/hr, photo signing 60/hr, org creation 10/day — per user, enforced in
the database (works across all serverless instances). If traffic grows
enough to make those counters hot, swap `api/app/services/ratelimit.py`
for Upstash Redis — call sites don't change.

**Known non-blockers:** `npm audit` reports dev-server/router advisories
that need major-version bumps (Vite 8, React Router 7) — schedule as a
follow-up, not a launch gate. Bundle is ~560 kB — fine to ship, code
splitting is a later optimization.

---

## Quick reference — local verification

```bash
# API unit tests (sqlite, no network)
cd api && .venv/Scripts/python -m pytest -q

# Live end-to-end (real Supabase + API running on :8000)
cd api && .venv/Scripts/python tests/smoke_e2e.py

# Web build + browser suite (API :8000 + vite dev :5173)
cd web && npm run build
cd web && npx playwright test
```

---

## The whole ecosystem — five pieces

```
landing/  → any static host          public hero — picks web vs app
web/      → Vercel static site       browser client
mobile/   → Expo / EAS               iOS + Android client
api/      → Vercel Python functions  shared backend (Bearer JWT + x-org-id)
Supabase  → auth, database, storage  shared data plane
```

One backend serves every client. Native apps aren't bound by CORS; they
authenticate with the same Supabase Bearer JWT and `x-org-id` header the web
app uses — nothing in `api/` changes for mobile.

### Mobile

- `mobile/README.md` is the runbook: Expo Go QR, LAN API (`--host 0.0.0.0`),
  `EXPO_PUBLIC_API_URL`, and the Google-OAuth caveat (dev builds with the
  `councilog://` scheme are reliable; Expo Go needs an `exp://**` entry in
  Supabase → Authentication → URL Configuration → Redirect URLs).
- Store builds go through EAS (`eas build`); the `councilog` scheme is in
  `mobile/app.json`.

### Landing page

`landing/` is framework-free static HTML — deploy to any static host (the
same Vercel project as `web/` works, or GitHub Pages/Netlify). Wire the CTA
buttons in `landing/links.js` — empty values render "coming soon" chips
instead of dead links.

---

## Require CI before merging to main

`.github/workflows/ci.yml` runs the API test suite, the web build, and the
mobile bundle check on every push and on pull requests into `main`. That
makes breakage *visible*; the settings below make it *blocking* — a
one-time GitHub UI change, not repo code.

1. GitHub repo → **Settings → Branches → Add branch ruleset** (or the
   classic "Add rule" if rulesets aren't shown).
2. Target: `main`.
3. Enable **Require a pull request before merging**.
4. Enable **Require status checks to pass** → in the check picker, search
   for **`ci`** and select it.
   - Gotcha: `ci` only appears in the picker **after the workflow has run
     at least once** (any push or PR). Push first, then set this.
5. Optional but recommended: **Require branches to be up to date before
   merging** — guarantees the check ran against the exact code being merged.

Why one `ci` check instead of `api` + `web` + `mobile` separately: the gate
job only passes when every real job passes, so new jobs added later are
covered automatically — the protection rule never needs editing.
