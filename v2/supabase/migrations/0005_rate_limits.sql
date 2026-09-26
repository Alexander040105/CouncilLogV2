-- 0005_rate_limits.sql — server-side fixed-window rate limit counters.
-- Spec §8.10 / OQ3: Supabase-table counters chosen for v1 (Vercel serverless
-- has no shared memory). Upstash Redis is the documented scale path.
create table if not exists rate_limits (
  key          text primary key,          -- e.g. 'joinreq:<user_id>'
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

alter table rate_limits enable row level security;
-- No policies: deny-by-default for anon/authenticated roles. Only the API
-- (service connection) reads/writes counters — never the web client.
