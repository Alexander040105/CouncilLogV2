-- 0010: freeform tasks, in-app notifications, push tokens, and the
-- offline-sync support columns.
--
-- tasks: assignable to-dos, optionally linked to a project / document /
-- journal entry. assignee_id/creator_id stay bare uuids — membership is
-- validated in the route layer via require_user_in_org (matches
-- projects.owner_id / project_checklist_items.assignee_id).
-- notifications: the in-app inbox — server-written only; members read
-- their own rows.
-- push_tokens: Expo push tokens per device; a member manages their own.
-- client_request_id: client-generated idempotency key so an offline
-- replay can never double-create a row.

create table tasks (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  title             text not null,
  description       text,
  assignee_id       uuid,
  creator_id        uuid not null,
  due_date          date,
  priority          text not null default 'normal'
                    check (priority in ('low','normal','high')),
  status            text not null default 'open'
                    check (status in ('open','done','cancelled')),
  project_id        uuid references projects(id) on delete set null,
  document_id       uuid references documents(id) on delete set null,
  journal_entry_id  uuid references journal_entries(id) on delete set null,
  completed_by      uuid,
  completed_at      timestamptz,
  client_request_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index tasks_by_org on tasks (org_id, status, due_date);
create index tasks_by_assignee on tasks (org_id, assignee_id) where status = 'open';
create unique index tasks_client_req on tasks (org_id, client_request_id)
  where client_request_id is not null;

create table task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  author_id  uuid not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index task_comments_by_task on task_comments (task_id, created_at);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_unread on notifications (user_id, read_at);

create table push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  token        text not null unique,
  platform     text not null check (platform in ('android','ios')),
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- offline outbox needs the movement's step so photos land on the right
-- process card (WP6 flow view); pre-existing rows stay null.
alter table document_movements
  add column step_id uuid references document_signatory_steps(id) on delete set null;

-- idempotency keys for offline replay — a post-commit-timeout retry must
-- return the original row, not a duplicate.
alter table journal_entries    add column client_request_id text;
alter table document_movements add column client_request_id text;
alter table documents          add column client_request_id text;
alter table projects           add column client_request_id text;

create unique index journal_client_req    on journal_entries    (org_id, client_request_id) where client_request_id is not null;
create unique index movements_client_req  on document_movements (org_id, client_request_id) where client_request_id is not null;
create unique index documents_client_req  on documents          (org_id, client_request_id) where client_request_id is not null;
create unique index projects_client_req   on projects           (org_id, client_request_id) where client_request_id is not null;

-- ── RLS ────────────────────────────────────────────────────────────────
alter table tasks          enable row level security;
alter table task_comments  enable row level security;
alter table notifications  enable row level security;
alter table push_tokens    enable row level security;

-- org tables: members read; all writes go through the API (service role).
create policy tasks_select on tasks for select using (is_org_member(org_id));
create policy task_comments_select on task_comments
  for select using (exists (select 1 from tasks t
                            where t.id = task_id and is_org_member(t.org_id)));

-- private rows: a member sees only their own notifications and tokens.
create policy notifications_self on notifications
  for select using (user_id = auth.uid());
create policy push_tokens_self_sel on push_tokens
  for select using (user_id = auth.uid());
create policy push_tokens_self_ins on push_tokens
  for insert with check (user_id = auth.uid());
create policy push_tokens_self_del on push_tokens
  for delete using (user_id = auth.uid());
