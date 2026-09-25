# CounciLog v2

Multi-tenant ops platform for student organizations.
Spec: [`spec.md`](./spec.md) · Product: [`PRODUCT.md`](./PRODUCT.md) · Design: [`DESIGN.md`](./DESIGN.md) · Roles & membership: [`ROLES.md`](./ROLES.md)

```
v2/
  api/                 FastAPI backend — owns ALL business logic
  web/                 React (JS) + Vite + Tailwind + TanStack Query (thin client)
  supabase/migrations/ Postgres DDL + RLS (apply to your Supabase project)
```

## One-time setup

### 1. Supabase project (hosted)

1. Create a free project at <https://supabase.com>.
2. In **SQL Editor**, run `supabase/migrations/0001_init.sql` (creates all
   tables + RLS).
3. In **Storage**, create a **private** bucket named `journal` (or set
   `STORAGE_BUCKET` to your name).
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
cd api && .venv/Scripts/python -m pytest tests -q   # unit logic (no DB needed)
cd web && npm run build                             # vite build
```

## Deploy (later phase)

Two Vercel projects per spec §3: `web/` as static build, `api/` as a Python
serverless deployment. Set the same env vars per project and point
`VITE_API_URL` / `WEB_ORIGIN` at each other.
