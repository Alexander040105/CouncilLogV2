-- 0016 — per-org theme + journal↔task link + comments on dailies
--
-- organizations.theme_json: {"preset"?: str, "accent"?: "#RRGGBB",
-- "brand"?: "#RRGGBB"} — validated by the API; absent/NULL = default.
-- journal_entries.task_id: the task this daily advanced (inverse of the
-- existing tasks.journal_entry_id, which marks a task's *source* log).
-- journal_entry_comments mirrors task_comments.

alter table organizations add column if not exists theme_json jsonb;
alter table journal_entries add column if not exists task_id uuid references tasks(id) on delete set null;
create index if not exists journal_by_task on journal_entries (task_id) where task_id is not null;

create table if not exists journal_entry_comments (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references journal_entries(id) on delete cascade,
  author_id  uuid not null,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists journal_comments_by_entry on journal_entry_comments (entry_id, created_at);

-- ── RLS (defense-in-depth; service role bypasses) ──────────────────────
alter table journal_entry_comments enable row level security;

create policy journal_comments_select on journal_entry_comments
  for select using (exists (select 1 from journal_entries j
                            where j.id = entry_id and is_org_member(j.org_id)));
