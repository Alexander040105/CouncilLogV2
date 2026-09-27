-- 0004: paper revision rounds — append-only re-sign cycles.
--
-- Step status vocabulary: pending → signed | skipped | revision_requested;
-- stale pendings become superseded when a new round opens.
-- Doc status vocabulary: drafting → routing → revision → signed → filed.

alter table document_signatory_steps
  add column round_no int not null default 1,
  add column revises  uuid references document_signatory_steps(id);

alter table document_signatory_steps drop constraint document_signatory_steps_status_check;
alter table document_signatory_steps add constraint document_signatory_steps_status_check
  check (status in ('pending','signed','skipped','revision_requested','superseded'));

alter table documents drop constraint documents_status_check;
alter table documents add constraint documents_status_check
  check (status in ('drafting','routing','signed','filed','revision'));

-- one row per revision request; append-only like document_movements
create table document_revisions (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  document_id          uuid not null references documents(id) on delete cascade,
  requested_at_step_id uuid references document_signatory_steps(id),
  round_no             int not null,
  note                 text not null,
  created_by           uuid references profiles(id),
  created_at           timestamptz not null default now()
);
create index revisions_by_doc on document_revisions (document_id, created_at);

alter table document_revisions enable row level security;
create policy revisions_select on document_revisions
  for select using (is_org_member(org_id));
revoke update, delete on document_revisions from public;
