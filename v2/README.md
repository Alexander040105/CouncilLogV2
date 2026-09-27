# CounciLog v2

Multi-tenant ops platform for student organizations.
Spec: [`spec.md`](./spec.md) · Product: [`PRODUCT.md`](./PRODUCT.md) · Design: [`DESIGN.md`](./DESIGN.md) · Roles & membership: [`ROLES.md`](./ROLES.md) · User guide: [`USER_GUIDE.md`](./USER_GUIDE.md) · Deploy: [`DEPLOY.md`](./DEPLOY.md)

```
v2/
  api/                 FastAPI backend — owns ALL business logic
  web/                 React (JS) + Vite + Tailwind + TanStack Query (thin client)
  supabase/migrations/ Postgres DDL + RLS (apply to your Supabase project)
```

## One-time setup

### 1. Supabase project (hosted)

1. Create a free project at <https://supabase.com>.
2. In **SQL Editor**, run every file in `supabase/migrations/` in order
   (`0001_init.sql` creates tables + RLS; later files add the `avatars`
   bucket and incremental columns).
3. In **Storage**, create a **private** bucket named `journal` (or set
   `STORAGE_BUCKET` to your name). The public `avatars` bucket is created by
   migration `0003_avatars_bucket.sql` — profile photos must be publicly
   readable because rosters render them as plain `<img src>`.
4. In **Authentication → Providers**, enable Email and Google (OAuth needs a
   Google client id/secret; add `https://<your-web-origin>/auth/callback` to
   redirect URLs).

### 2. API env — `api/.env` (copy `.env.example`)

| Var | Where to get it |
|---|---|
| `SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Project Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role key — **server only** |
| `SUPABASE_JWT_SECRET` | Project Settings → API → JWT Secret (HS256 projects only; asymmetric projects leave blank — JWKS auto-fetched) |
| `DATABASE_URL` | Settings → Database → Connection string → **pooler** (change driver to `postgresql+asyncpg://`) |
| `WEB_ORIGIN` | your web origin (default `http://localhost:5173`) |
| `APP_BASE_URL` | public URL of the web app — used for links inside notification emails |
| `SMTP_HOST` / `SMTP_PORT` | Maileroo SMTP — default `smtp.maileroo.com:587` |
| `SMTP_USER` / `SMTP_PASSWORD` | Maileroo SMTP credentials — leave empty to disable email sending |
| `MAIL_FROM` | verified sender, e.g. `CounciLog <no-reply@yourdomain.com>` |

### 3. Web env — `web/.env` (copy `.env.example`)

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`
(default `http://localhost:8000/api/v1`).

## Run locally

```bash
# api
cd api && python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # windows
.venv/Scripts/uvicorn app.main:app --reload --port 8000

# web
cd web && npm install && npm run dev               # http://localhost:5173
```

## Verify

```bash
cd api && .venv/Scripts/python -m pytest -q          # unit logic (no DB needed)
cd api && .venv/Scripts/python tests/smoke_e2e.py    # 73 live checks vs real Supabase (API on :8000)
cd web && npm run build                              # vite build
cd web && npx playwright test                        # browser suite (API :8000 + vite dev :5173)
```

## Deploy

Two free-tier Vercel projects: `web/` (static Vite build) and `api/`
(Python serverless — `app.main:app` auto-detected). Full runbook, env
matrix, Supabase checklist, and rollback notes: [`DEPLOY.md`](./DEPLOY.md).
