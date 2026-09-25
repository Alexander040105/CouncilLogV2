-- CounciLog · 0001_init.sql
-- Multi-tenant schema per v2/spec.md §4. Apply in Supabase SQL editor or
-- `supabase db push`. All org-scoped tables carry org_id; RLS deny-by-default
-- for non-service access (FastAPI uses the service role + app-level authz).

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ── Identity & tenancy ─────────────────────────────────────────────────
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        citext not null unique,
  logo_url    text,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create table school_years (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  label      text not null,
  is_current boolean not null default false,
  starts_on  date,
  ends_on    date,
  unique (org_id, label)
);

create table org_members (
  org_id         uuid not null references organizations(id) on delete cascade,
  user_id        uuid not null references profiles(id),
  school_year_id uuid references school_years(id),
  role           text not null check (role in ('owner','adviser','officer','member')),
  status         text not null default 'pending'
                 check (status in ('pending','active','rejected','removed')),
  joined_at      timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table positions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  school_year_id uuid not null references school_years(id) on delete cascade,
  title          text not null,
  rank           int  not null default 0,
  holder         uuid,
  reports_to     uuid references positions(id),
  unique (org_id, school_year_id, title),
  foreign key (org_id, holder) references org_members (org_id, user_id)
);

create table duty_schedules (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  school_year_id uuid not null references school_years(id) on delete cascade,
  weekday        smallint not null check (weekday between 0 and 6),  -- 0=Mon
  member_id      uuid not null,
  unique (org_id, school_year_id, weekday, member_id),
  foreign key (org_id, member_id) references org_members (org_id, user_id)
);

-- ── Attendance & journal ────────────────────────────────────────────────
create table attendance_days (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  member_id  uuid not null,
  day        date not null,
  status     text not null check (status in ('documented','declared_no_tasks')),
  duty_type  text not null check (duty_type in ('scheduled','extra')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, day),
  foreign key (org_id, member_id) references org_members (org_id, user_id)
);

create table projects (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references organizations(id) on delete cascade,
  title                  text not null,
  details                text,
  event_type             text,
  target_date            date,
  owner_id               uuid,
  status                 text not null default 'draft'
                         check (status in ('draft','active','done','archived')),
  needs_paper_processing boolean not null default false,
  needs_logistics        boolean not null default false,
  created_at             timestamptz not null default now(),
  foreign key (org_id, owner_id) references org_members (org_id, user_id)
);
create index projects_by_org on projects (org_id, status, target_date);

create table journal_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  member_id   uuid not null,
  entry_date  date not null,
  description text not null check (char_length(description) between 1 and 4000),
  project_id  uuid references projects(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (org_id, member_id) references org_members (org_id, user_id)
);
create index journal_by_member_day on journal_entries (member_id, entry_date);
create index journal_by_org_day    on journal_entries (org_id, entry_date);

create table journal_photos (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references journal_entries(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,
  storage_path text not null unique,
  mime         text not null check (mime in ('image/jpeg','image/png','image/webp')),
  byte_size    int  not null check (byte_size <= 5242880),
  created_at   timestamptz not null default now()
);

-- ── Checklists ──────────────────────────────────────────────────────────
create table checklist_templates (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  track      text not null check (track in ('paper','logistics','both')),
  event_type text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table checklist_template_items (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id) on delete cascade,
  ord         int not null,
  label       text not null,
  hint        text,
  required    boolean not null default true,
  rule_json   jsonb
);
create index ct_items_by_template on checklist_template_items (template_id, ord);

create table project_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  template_id uuid references checklist_templates(id),
  ord         int not null,
  label       text not null,
  hint        text,
  required    boolean not null default true,
  due_date    date,
  done        boolean not null default false,
  done_by     uuid,
  done_at     timestamptz
);
create index pci_by_project on project_checklist_items (project_id, ord);

-- ── Paper logbook ───────────────────────────────────────────────────────
create table documents (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id),
  title      text not null,
  doc_type   text not null,
  status     text not null default 'drafting'
             check (status in ('drafting','routing','signed','filed')),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index documents_by_org on documents (org_id, status, created_at desc);

create table document_movements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  document_id   uuid not null references documents(id) on delete cascade,
  location_text text not null,
  note          text,
  photo_path    text,
  moved_by      uuid not null,
  created_at    timestamptz not null default now()
);
create index movements_by_doc on document_movements (document_id, created_at);
revoke update, delete on document_movements from public;

create table signatory_chains (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organizations(id) on delete cascade,
  name     text not null,
  doc_type text not null
);

create table signatory_steps (
  id             uuid primary key default gen_random_uuid(),
  chain_id       uuid not null references signatory_chains(id) on delete cascade,
  ord            int not null,
  label          text not null,
  office         text,
  condition_json jsonb
);
create index steps_by_chain on signatory_steps (chain_id, ord);

create table document_signatory_steps (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  ord         int not null,
  label       text not null,
  office      text,
  status      text not null default 'pending'
             check (status in ('pending','signed','skipped')),
  signed_at   timestamptz,
  noted_by    uuid,
  note        text
);
create index dss_by_doc on document_signatory_steps (document_id, ord);

-- ── Membership flows ────────────────────────────────────────────────────
create table invites (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  code       text not null unique,
  role       text not null check (role in ('adviser','officer','member')),
  expires_at timestamptz not null,
  max_uses   int  not null default 1,
  uses       int  not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table join_requests (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references profiles(id),
  message    text,
  status     text not null default 'pending'
             check (status in ('pending','approved','rejected')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table org_contacts (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organizations(id) on delete cascade,
  label    text not null,
  value    text not null,
  category text,
  ord      int not null default 0
);

-- ── Audit ───────────────────────────────────────────────────────────────
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  actor_id    uuid references auth.users(id),
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index audit_by_org on audit_log (org_id, created_at);
revoke update, delete on audit_log from public;

-- ── RLS helpers ─────────────────────────────────────────────────────────
create or replace function is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from org_members
                  where org_id = p_org and user_id = auth.uid()
                    and status = 'active') $$;

create or replace function has_org_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from org_members
                  where org_id = p_org and user_id = auth.uid()
                    and status = 'active' and role = any(p_roles)) $$;

-- ── RLS policies (defense-in-depth; service role bypasses) ─────────────
alter table organizations            enable row level security;
alter table profiles                 enable row level security;
alter table school_years             enable row level security;
alter table org_members              enable row level security;
alter table positions                enable row level security;
alter table duty_schedules           enable row level security;
alter table attendance_days          enable row level security;
alter table journal_entries          enable row level security;
alter table journal_photos           enable row level security;
alter table projects                 enable row level security;
alter table checklist_templates      enable row level security;
alter table checklist_template_items enable row level security;
alter table project_checklist_items  enable row level security;
alter table documents                enable row level security;
alter table document_movements       enable row level security;
alter table signatory_chains         enable row level security;
alter table signatory_steps          enable row level security;
alter table document_signatory_steps enable row level security;
alter table invites                  enable row level security;
alter table join_requests            enable row level security;
alter table org_contacts             enable row level security;
alter table audit_log                enable row level security;

-- members read their org's rows; writes go through the service role.
create policy org_member_select on organizations
  for select using (is_org_member(id) or created_by = auth.uid());
create policy profiles_self on profiles
  for select using (id = auth.uid());
create policy profiles_self_upd on profiles
  for update using (id = auth.uid());
create policy sy_select on school_years for select using (is_org_member(org_id));
create policy members_select on org_members for select using (is_org_member(org_id));
create policy positions_select on positions for select using (is_org_member(org_id));
create policy duty_select on duty_schedules for select using (is_org_member(org_id));
create policy attendance_select on attendance_days for select using (is_org_member(org_id));
create policy attendance_ins on attendance_days
  for insert with check (is_org_member(org_id) and member_id = auth.uid());
create policy journal_select on journal_entries for select using (is_org_member(org_id));
create policy journal_ins on journal_entries
  for insert with check (is_org_member(org_id) and member_id = auth.uid());
create policy journal_upd on journal_entries
  for update using (is_org_member(org_id) and member_id = auth.uid());
create policy jphotos_select on journal_photos for select using (is_org_member(org_id));
create policy jphotos_ins on journal_photos
  for insert with check (is_org_member(org_id));
create policy projects_select on projects for select using (is_org_member(org_id));
create policy ct_select on checklist_templates for select using (is_org_member(org_id));
create policy cti_select on checklist_template_items
  for select using (exists (select 1 from checklist_templates t
                            where t.id = template_id and is_org_member(t.org_id)));
create policy pci_select on project_checklist_items for select using (is_org_member(org_id));
create policy documents_select on documents for select using (is_org_member(org_id));
create policy movements_select on document_movements for select using (is_org_member(org_id));
create policy chains_select on signatory_chains for select using (is_org_member(org_id));
create policy steps_select on signatory_steps
  for select using (exists (select 1 from signatory_chains c
                            where c.id = chain_id and is_org_member(c.org_id)));
create policy dss_select on document_signatory_steps for select using (is_org_member(org_id));
create policy invites_select on invites
  for select using (has_org_role(org_id, array['owner']));
create policy jr_mine_or_owner on join_requests
  for select using (user_id = auth.uid() or has_org_role(org_id, array['owner']));
create policy jr_insert on join_requests for insert with check (user_id = auth.uid());
create policy contacts_select on org_contacts for select using (is_org_member(org_id));
create policy audit_select on audit_log
  for select using (has_org_role(org_id, array['owner','adviser']));
