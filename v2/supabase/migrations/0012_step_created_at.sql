-- 0012: document_signatory_steps.created_at — the stale-desk clock.
-- The reminders cron pings a desk when a paper's pending step is ≥3 days
-- old; it needs a "when did this step become the active desk" timestamp.
-- Existing rows get the migration timestamp — nothing pings stale until a
-- step is genuinely old post-deploy.

alter table document_signatory_steps
  add column if not exists created_at timestamptz not null default now();
