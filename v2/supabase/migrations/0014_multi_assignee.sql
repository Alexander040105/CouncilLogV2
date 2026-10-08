-- Multi-assignee: junction tables for tasks + project checklist items.
-- The single assignee_id columns stay as the "lead" (first assignee) so
-- older clients keep working; junction rows are the source of truth.

create table if not exists task_assignees (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null,
  primary key (task_id, user_id)
);

create table if not exists checklist_item_assignees (
  item_id uuid not null references project_checklist_items(id) on delete cascade,
  user_id uuid not null,
  primary key (item_id, user_id)
);

insert into task_assignees (task_id, user_id)
  select id, assignee_id from tasks where assignee_id is not null
  on conflict do nothing;

insert into checklist_item_assignees (item_id, user_id)
  select id, assignee_id from project_checklist_items where assignee_id is not null
  on conflict do nothing;

-- "tasks/items assigned to me" lookups
create index if not exists task_assignees_by_user on task_assignees (user_id);
create index if not exists checklist_item_assignees_by_user on checklist_item_assignees (user_id);

-- ── RLS (defense-in-depth; service role bypasses) ──────────────────────
alter table task_assignees            enable row level security;
alter table checklist_item_assignees  enable row level security;

create policy task_assignees_select on task_assignees
  for select using (exists (select 1 from tasks t
                            where t.id = task_id and is_org_member(t.org_id)));
create policy cia_select on checklist_item_assignees
  for select using (exists (select 1 from project_checklist_items i
                            where i.id = item_id and is_org_member(i.org_id)));
