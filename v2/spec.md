# CounciLog — Product & Technical Specification

> Multi-tenant operations platform for student organizations.
> Web client (React) · API (FastAPI) · Data/Auth/Storage (Supabase).
> Generated per `v2/SWE2_SPEC_PROMPT.md`. Domain source: `COUNCIL_HANDBOOK_V2.md`.
> Status: **specification only — no code written yet.**

---

## 1. Overview & Goals

### Problem statement

Student councils run on paper: concept papers physically routed between
offices for signatures, duty attendance that's really about who *did* work
(not who clocked in), event logistics tracked in group chats, and process
knowledge living in a handbook that few read. Nothing tracks where a document
physically is, who has it, or what step of the signature chain it's on.

### What CounciLog is

A multi-tenant web application where each student organization gets an
isolated workspace covering five loops:

1. **Attendance = documented participation.** Every duty member files a daily
   entry — work done (photo journal) or an explicit "no tasks" declaration.
   No time-clock mechanics; officers have incompatible class schedules.
2. **Daily Journal.** Photo + description proof of work, feeding attendance.
3. **Projects tracker.** Upcoming events with paper-processing and logistics
   checklists generated from org-defined templates.
4. **Paper logbook.** Digital record of physical documents: where they are,
   who moved them, photographic evidence, and which signatory step they're on.
5. **Org management.** Invite/approval membership, per-school-year positions
   and org charts, configurable duty schedules.

### Success criteria

- CCS Council (SY 2026–2027, ~25 officers) uses it daily for a full semester
  without falling back to chat-based tracking for the five loops above.
- A second organization onboards with **zero code changes** — only template
  and roster entry through admin screens (proves the SaaS claim).
- Cross-tenant isolation test passes in CI (see §12).

### Explicit non-goals (v1)

- Not a document editor — papers are still authored in Google Docs; CounciLog
  tracks them.
- Not a social network, chat, or public site.
- No digital signature capture — signatory tracking is status/metadata of
  physical papers.
- No realtime push, email notifications, or native apps (roadmap phases).

---

## 2. Personas & Roles

Roles are **per-org** (stored on `org_members`, not on the user). One human
(`auth.users` + `profiles`) may belong to many orgs with different roles.

| Persona | Role enum | Who |
|---|---|---|
| Org owner / president | `owner` | Creates the org or holds the top position; full control incl. role assignment, templates, duty schedule |
| Adviser | `adviser` | Faculty adviser; read-all, approves sensitive steps, cannot edit org structure |
| Officer | `officer` | Duty member; files daily entries/journal, works checklists, moves documents |
| Member | `member` | General member; read-mostly, can file journal entries |
| Pending / invitee | `pending` (status) | Has account, requested join or holds invite; sees nothing until approved |
| Platform operator | — | CounciLog maintainer; operates via Supabase dashboard / service key, NOT an in-app super-admin for MVP |

### Permission matrix (per org)

| Capability | owner | adviser | officer | member |
|---|:-:|:-:|:-:|:-:|
| Manage org settings, invite links, approve joins | ✓ | | | |
| Assign positions / edit org chart / duty schedule | ✓ | | | |
| Create/edit checklist & signatory templates | ✓ | | | |
| Create/edit projects, instantiate checklists | ✓ | ✓ | | |
| Check off checklist items | ✓ | ✓ | ✓ | |
| Create documents, record movements, advance signature steps | ✓ | ✓ | ✓ | |
| File journal entries (own) / declare "no tasks" (own) | ✓ | ✓ | ✓ | ✓ |
| View all journal/attendance/projects/documents in org | ✓ | ✓ | ✓ | ✓ |
| Edit/annotate others' journal entries after day closes | ✓ | | | |
| View audit log | ✓ | ✓ | | |
| Export org data | ✓ | | | |

---

## 3. Feature Specifications

### 3.1 Auth & org onboarding

- **Auth** via Supabase Auth: email/password **and** Google OAuth, available
  to org creators and regular members alike. FastAPI verifies the Supabase JWT
  (`Authorization: Bearer`) on every request and resolves identity →
  `profiles` + `org_members` context.
- **Create org** — authenticated user submits org name (+ optional slug/logo);
  becomes `owner` with `active` membership; a default current `school_year`
  row is created.
- **Invite links** — owner generates `invites` rows (code, role granted,
  expiry, max uses). Redeeming requires an authenticated account and creates
  `active` membership at the invite's role (not `pending`) — the link itself
  is the approval.
- **Join requests** — a user can also request to join a discoverable org
  (by slug/code); creates `join_requests(status='pending')`; owner approves
  → `org_members` active row; rejects → status `rejected` + audit entry.
- **Positions / org chart** — per `school_year`, owner defines `positions`
  (title, rank, optional `reports_to` → forms the org chart tree) and assigns
  `holder` (an active org member). History is preserved because positions are
  scoped to school year — new year = new position set.
- **Edge cases:** duplicate join requests collapse to one pending; invite
  redemption past `max_uses`/expiry → 410; removing a member sets
  `status='removed'` (history preserved, access revoked).

### 3.2 Attendance — participation-based

- Core rule: **attendance = a filed daily entry, not a timestamp.**
- `attendance_days(member, date)` — one row per member per org day. States:
  - `documented` — member has ≥1 journal entry that day (auto-derived; the
    row is upserted when a journal entry lands).
  - `declared_no_tasks` — member explicitly filed "no tasks today".
  - `unaccounted` — derived/absent row: scheduled duty day passed with no
    entry. Computed in views, not stored.
- `duty_type`: `scheduled` (member is on that weekday's duty roster) vs
  `extra` (any other day — always allowed, never blocked).
- **Duty schedule** is org config per school year: `duty_schedules` maps
  `weekday` → set of members (CCS's Mon–Fri roster ships as seed data).
- **Views:** day roster (who filed / who didn't), member history, weekly
  compliance % per officer (`documented+declared days / scheduled weekdays`),
  org heatmap optional.
- **Timezone:** "day" boundaries use `Asia/Manila` — stored as `date`,
  interpreted in org timezone.
- **Edge cases:** entry filed at 23:59 counts for that Manila date; deleting
  a journal entry does NOT retroactively mark the day unaccounted if
  `declared_no_tasks` was also filed; editing entries same-day is free,
  post-day edits are owner-only and audited.

### 3.3 Daily Journal

- `journal_entries` — `member + entry_date + description`, optional
  `project_id` tag; multiple entries per member per day allowed.
- `journal_photos` — 1..N photos per entry. Upload flow (serverless-safe):
  1. `POST /journal/photos/sign` → API validates intent (member active,
     org quota), returns **Storage signed upload URL** + target path
     `org_id/entry_uuid/photo_uuid`.
  2. Client PUTs bytes directly to Supabase Storage.
  3. `POST /journal/entries` references the uploaded path; API verifies the
     object exists, checks magic bytes + size, strips EXIF server-side or via
     client pre-strip (see §10/OQ).
- Photos are viewable only via `GET /journal/photos/{id}/url` → API authz →
  short-lived signed **download** URL (TTL ≤ 15 min). No public bucket.
- Journal satisfies that day's attendance (`documented`).
- **Edge cases:** "no tasks" day has no journal requirement; orphaned uploads
  (signed but never referenced) are cleaned by a scheduled sweep (roadmap P5).

### 3.4 Projects tracker

- `projects` — title, details, `target_date`, `owner`, `status`
  (`draft|active|done|archived`), flags `needs_paper_processing` /
  `needs_logistics`, optional `event_type` used for template matching.
- **Checklists instantiate from templates:** on project creation (or on
  demand) the server copies matching `checklist_template_items` into
  `project_checklist_items` — a **snapshot**, so later template edits never
  rewrite a running project's checklist.
- Deadline rules live in template config (`rule_json`), e.g. CHED outside-event
  items carry `due_days_before_event: 15`; financial report template carries
  `due_days_after_event: 7`. API computes `due_date` at instantiation from
  `target_date`.
- **Views:** project board grouped by status; per-project detail showing
  paper-processing checklist, logistics checklist, linked documents, linked
  journal entries.

### 3.5 Paper logbook (document tracking)

- `documents` — title, `doc_type` (concept_paper, board_resolution,
  financial_report, activity_report, letter…), `status`
  (`drafting|routing|revision|signed|filed`), optional `project_id`.
- `document_movements` — **append-only** logbook: each row = one custody
  record (`location_text` free-form e.g. "SD office", `note`, optional
  `photo_path`, `moved_by`, `created_at`). Never UPDATEd/DELETEd — DB-level
  revoke + audit trigger.
- `document_signatory_steps` — instantiated snapshot of a `signatory_chain`;
  each step `pending|signed|skipped|revision_requested|superseded`, advanced
  by officers via API (records `signed_at`, `noted_by`). `round_no` groups
  rows into signing rounds; `revises` points at the step a round-N row
  re-signs. Conditional steps are materialized at instantiation per §7 rules
  (e.g., international webinar ⇒ RFP step inserted).
- `document_revisions` — append-only revision requests: `document_id`,
  `requested_at_step_id` (null when the whole resolved doc is sent back),
  `round_no`, required `note`, `created_by`. A revision supersedes stale
  pendings and appends fresh `pending` copies of the chosen resolved steps —
  history is never overwritten. Late revisions are allowed on `signed` and
  `filed` docs.
- Logbook view = vertical timeline: signature steps interleaved with
  movement records — "where is the paper" is always the latest movement row.
- **Edge cases:** a paper can skip a step (`skipped` + note, audited); a doc
  with no chain still gets movements and can be routed later via
  `attach-chain`; photos optional but encouraged; "sign all pending"
  bulk-signs the current round.

### 3.6 SaaS configurability

- Everything org-specific is **data**: `positions`, `checklist_templates`,
  `signatory_chains`+`signatory_steps`, `duty_schedules`, `org_contacts`
  (quick-reference directory). Admins edit via Settings screens; no per-org
  code paths.
- CCS values ship as **seed templates** (§9) — demonstrating that tenant #2's
  onboarding is data entry, not engineering.
- **Edge cases:** template edits never mutate live instances (snapshot
  semantics); deleting a template keeps existing project checklists intact;
  position reassignment mid-year keeps `positions` row history via school-year
  scoping + `rank` ordering.

---

## 4. Data Model — DDL + RLS

Conventions: `uuid` PKs default `gen_random_uuid()` (pgcrypto), `timestamptz`
for moments, `date` for calendar days (Asia/Manila), `citext` for slugs/emails
where useful. All org-scoped tables carry `org_id` FK → `organizations`.

```sql
create extension if not exists pgcrypto;

-- ── Identity ──────────────────────────────────────────────────────────
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
  label      text not null,                -- 'SY 2026–2027'
  is_current boolean not null default false,
  starts_on  date, ends_on date,
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
  holder         uuid,                       -- org_members.user_id (app-enforced composite)
  reports_to     uuid references positions(id),
  unique (org_id, school_year_id, title)
);

create table duty_schedules (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  school_year_id uuid not null references school_years(id) on delete cascade,
  weekday        smallint not null check (weekday between 0 and 6),  -- 0=Mon
  member_id      uuid not null,               -- org_members.user_id
  unique (org_id, school_year_id, weekday, member_id)
);

-- ── Attendance & journal ──────────────────────────────────────────────
create table attendance_days (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  member_id          uuid not null,           -- org_members.user_id
  day                date not null,
  status             text not null
                     check (status in ('documented','declared_no_tasks')),
  duty_type          text not null check (duty_type in ('scheduled','extra')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (member_id, day)
);

create table journal_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  member_id   uuid not null,
  entry_date  date not null,
  description text not null check (char_length(description) between 1 and 4000),
  project_id  uuid,                           -- set after projects exists
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index journal_by_member_day on journal_entries (member_id, entry_date);
create index journal_by_org_day    on journal_entries (org_id, entry_date);

create table journal_photos (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references journal_entries(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,
  storage_path text not null unique,          -- '{org_id}/{entry_id}/{uuid}'
  mime         text not null check (mime in ('image/jpeg','image/png','image/webp')),
  byte_size    int  not null check (byte_size <= 5242880),  -- 5 MB
  created_at   timestamptz not null default now()
);

-- ── Projects & checklists ─────────────────────────────────────────────
create table projects (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organizations(id) on delete cascade,
  title                   text not null,
  details                 text,
  event_type              text,               -- 'seminar','competition','outside','ces','webinar_intl',…
  target_date             date,
  owner_id                uuid,               -- org_members.user_id
  status                  text not null default 'draft'
                          check (status in ('draft','active','done','archived')),
  needs_paper_processing  boolean not null default false,
  needs_logistics         boolean not null default false,
  created_at              timestamptz not null default now()
);
alter table journal_entries
  add constraint journal_project_fk foreign key (project_id) references projects(id);

create table checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  track       text not null check (track in ('paper','logistics','both')),
  event_type  text,                           -- match projects.event_type; null = generic
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table checklist_template_items (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id) on delete cascade,
  ord         int not null,
  label       text not null,
  hint        text,
  required    boolean not null default true,
  rule_json   jsonb                           -- {'due_days_before_event':15} | {'insert_if':'international_webinar'}
);
create index ct_items_by_template on checklist_template_items (template_id, ord);

create table project_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  template_id     uuid references checklist_templates(id),  -- provenance
  ord             int not null,
  label           text not null,              -- snapshot copy
  hint            text,
  required        boolean not null default true,
  due_date        date,                       -- computed from rule_json at instantiate
  done            boolean not null default false,
  done_by         uuid,
  done_at         timestamptz
);
create index pci_by_project on project_checklist_items (project_id, ord);

-- ── Paper logbook ─────────────────────────────────────────────────────
create table documents (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id),
  title      text not null,
  doc_type   text not null,                   -- 'concept_paper','board_resolution','financial_report',…
  status     text not null default 'drafting'
             check (status in ('drafting','routing','signed','filed')),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table document_movements (             -- APPEND-ONLY
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  document_id   uuid not null references documents(id) on delete cascade,
  location_text text not null,                -- 'SD office', 'SAS — Ma\'am Ana'
  note          text,
  photo_path    text,                         -- private storage path
  moved_by      uuid not null,
  created_at    timestamptz not null default now()
);
create index movements_by_doc on document_movements (document_id, created_at);
revoke update, delete on document_movements from public;

create table signatory_chains (               -- templates
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  doc_type   text not null
);
create table signatory_steps (
  id             uuid primary key default gen_random_uuid(),
  chain_id       uuid not null references signatory_chains(id) on delete cascade,
  ord            int not null,
  label          text not null,               -- 'SSC President','SAS routing','School Director'
  office         text,                        -- '2nd floor hallway, left side'
  condition_json jsonb                        -- {'include_if_event_type':'webinar_intl'} etc.
);
create index steps_by_chain on signatory_steps (chain_id, ord);

create table document_signatory_steps (       -- instantiated snapshot
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  ord         int not null,
  label       text not null,
  office      text,
  status      text not null default 'pending'
             check (status in ('pending','signed','skipped','revision_requested','superseded')),
  round_no    int not null default 1,
  revises     uuid references document_signatory_steps(id),
  signed_at   timestamptz,
  noted_by    uuid,
  note        text
);
create index dss_by_doc on document_signatory_steps (document_id, ord);

create table document_revisions (             -- append-only revision requests
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

-- ── Membership flows ──────────────────────────────────────────────────
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
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table org_contacts (                   -- quick-reference directory
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organizations(id) on delete cascade,
  label    text not null,                     -- 'Financial report questions'
  value    text not null,                     -- 'Ate Bella / Jade / Christel'
  category text,
  ord      int not null default 0
);

-- ── Audit ─────────────────────────────────────────────────────────────
create table audit_log (                      -- APPEND-ONLY
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  actor_id    uuid references auth.users(id),
  action      text not null,                  -- 'document.moved','signatory.advanced','member.approved',…
  entity_type text not null,
  entity_id   uuid,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index audit_by_org on audit_log (org_id, created_at);
revoke update, delete on audit_log from public;
```

### RLS helper functions + policy pattern

FastAPI connects with the **service-role key** (bypasses RLS) and authorizes
in app code. Policies still exist so that anon/authenticated direct-table
access gets **deny-by-default** and any future per-user passthrough is safe:

```sql
create or replace function is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from org_members
                  where org_id = p_org and user_id = auth.uid() and status = 'active') $$;

create or replace function has_org_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from org_members
                  where org_id = p_org and user_id = auth.uid()
                    and status = 'active' and role = any(p_roles)) $$;

-- Example policy set — same pattern on every org-scoped table:
alter table journal_entries enable row level security;
create policy journal_select on journal_entries
  for select using (is_org_member(org_id));
create policy journal_insert on journal_entries
  for insert with check (is_org_member(org_id));
create policy journal_update on journal_entries
  for update using (is_org_member(org_id) and member_id = auth.uid());
-- no delete policy → deletes impossible via user paths

-- document_movements & audit_log: select-only for members, no insert/update/delete
-- user-facing policies (service role writes them).
create policy movements_select on document_movements
  for select using (is_org_member(org_id));
create policy audit_select on audit_log
  for select using (has_org_role(org_id, array['owner','adviser']));
```

Apply the pattern to all tables: `select` = `is_org_member`; `insert/update` =
same + role gates where the matrix requires; `delete` = owner-only or none.

### Index notes

Composite `(org_id, …)` indexes on every hot path (listed inline above):
`journal_entries(org_id, entry_date)`, `attendance_days(member_id, day)`,
`document_movements(document_id, created_at)`, `audit_log(org_id, created_at)`,
`project_checklist_items(project_id, ord)`.

---

## 5. API Specification

Base: `/api/v1`. Auth: `Authorization: Bearer <supabase-jwt>` on every route
except `GET /health`. Every route resolves `org_id` (path param or
`X-Org-Id` header) through a single **`authorize(org_id, min_role)`**
dependency — no endpoint ships without it. Responses use the error envelope
`{error: {code, message, details?}}` (never stack traces). List endpoints are
paginated (`?page=&pageSize=`, default 20, max 100; response wraps
`{data, pagination}`).

| # | Method & path | Role | Purpose |
|---|---|---|---|
| 1 | `GET /health` | — | liveness |
| 2 | `GET /me` | any auth | profile + my orgs/roles |
| 3 | `POST /orgs` | any auth | create org → caller = owner |
| 4 | `GET /orgs/{org}` | member | org detail + my role |
| 5 | `PATCH /orgs/{org}` | owner | rename, logo, settings |
| 6 | `GET /orgs/{org}/members` | member | roster w/ roles & positions |
| 7 | `POST /orgs/{org}/invites` | owner | mint invite (role, expiry, uses) |
| 8 | `POST /invites/{code}/redeem` | any auth | join via invite |
| 9 | `POST /orgs/{org}/join-requests` | any auth | request to join |
| 10 | `GET /orgs/{org}/join-requests` | owner | pending queue |
| 11 | `POST /orgs/{org}/join-requests/{id}/decide` | owner | approve/reject |
| 12 | `PATCH /orgs/{org}/members/{user}` | owner | change role / remove |
| 13 | `GET/PUT /orgs/{org}/school-years` | member / owner | list / create & set current |
| 14 | `GET/POST /orgs/{org}/positions` | member / owner | org chart CRUD (per SY) |
| 15 | `PATCH /orgs/{org}/positions/{id}` | owner | assign holder, rank, reports_to |
| 16 | `GET /orgs/{org}/org-chart` | member | tree view for current SY |
| 17 | `GET/PUT /orgs/{org}/duty-schedule` | member / owner | weekday → members roster |
| 18 | `GET /orgs/{org}/attendance` | member | `?day=`/`?from=&to=`/`?member=` views |
| 19 | `GET /orgs/{org}/attendance/summary` | member | per-officer compliance % |
| 20 | `POST /orgs/{org}/attendance/no-tasks` | self | declare "no tasks today" |
| 21 | `GET /orgs/{org}/journal` | member | feed `?day=`/`?member=`/`?project=` |
| 22 | `POST /orgs/{org}/journal` | member+ | create entry (photo paths) |
| 23 | `PATCH /orgs/{org}/journal/{id}` | self-day / owner | edit entry |
| 24 | `POST /orgs/{org}/journal/photos/sign` | member+ | mint signed upload URL |
| 25 | `GET /orgs/{org}/photos/{id}/url` | member | mint signed download URL |
| 26 | `GET/POST /orgs/{org}/projects` | member / owner+adviser | list / create |
| 27 | `GET/PATCH /orgs/{org}/projects/{id}` | member / owner+adviser | detail / update |
| 28 | `POST /orgs/{org}/projects/{id}/instantiate` | owner, adviser | build checklists from templates |
| 29 | `GET /orgs/{org}/projects/{id}/checklist` | member | items w/ done state |
| 30 | `PATCH /orgs/{org}/checklist-items/{id}` | officer+ | check/uncheck item |
| 31 | `GET/POST /orgs/{org}/checklist-templates` | member / owner | template CRUD (+items) |
| 32 | `GET/POST /orgs/{org}/documents` | member / officer+ | list / create document |
| 33 | `GET /orgs/{org}/documents/{id}` | member | detail = timeline |
| 34 | `POST /orgs/{org}/documents/{id}/movements` | officer+ | append movement (where/who/photo) |
| 35 | `POST /orgs/{org}/documents/{id}/steps/{sid}` | officer+ | mark step signed/skipped |
| 35a | `POST /orgs/{org}/documents/{id}/attach-chain` | officer+ | route an unrouted doc to a chosen chain |
| 35b | `POST /orgs/{org}/documents/{id}/revisions` | officer+ | send back for revision → new round of re-sign steps |
| 35c | `POST /orgs/{org}/documents/{id}/steps/sign-all` | officer+ | bulk-sign current-round pending steps |
| 36 | `GET/POST /orgs/{org}/signatory-chains` | member / owner | chain templates + steps |
| 37 | `GET/POST /orgs/{org}/contacts` | member / owner | quick-ref directory |
| 38 | `GET /orgs/{org}/audit` | owner, adviser | audit log paged |
| 39 | `GET /orgs/{org}/export` | owner | org data export (JSON/zip) — P5 |
| 40 | `GET /orgs/{org}/attendance/{member}` | member | member history (self or owner/adviser view all) |
| 41 | `PATCH /me` | self | update own `display_name`/`avatar_url` only — allowlist, no role/org writes |
| 42 | `POST /me/avatar/sign` | self | mint signed upload URL to public `avatars` bucket |
| 43 | `DELETE /me` | self | anonymize + remove memberships + ban auth user (409 if sole owner) |

**Auth plumbing:** `GET /me` returns `memberships[]`; the client sends
`X-Org-Id` per call or uses `/orgs/{org}/…` paths. OAuth: Supabase Google
provider → redirect back to web `/auth/callback` → exchange → Bearer tokens.

---

## 6. Screen / Route Inventory

Evolves the legacy IA (`legacy_code/CounciLog/templates/index.html`: navbar
search + sidebar Home/Projects/Members/Calendar/Files + Dailies).

| Route | Legacy map | Contents |
|---|---|---|
| `/login`, `/auth/callback` | — | email/pw + Google button |
| `/onboarding` | — | create-org vs join (invite code / request) |
| `/` Dashboard | Home | today's duty roster, my filing status, open checklist deadlines, recent movements |
| `/journal` | Dailies | photo feed by day; compose = photo+description or "no tasks" toggle (≤3 taps) |
| `/attendance` | Calendar | day/week/member views + compliance summary |
| `/projects`, `/projects/{id}` | Projects | board by status; detail = dual checklists + docs + linked journals |
| `/documents`, `/documents/{id}` | Files | logbook list; detail = movement+signature timeline, "move paper" action w/ camera |
| `/members` | Members | roster; `/members/chart` = org chart per SY |
| `/settings` (owner/adviser) | — | positions, duty schedule, checklist templates, signatory chains, contacts, invites, audit |
| `/account` | — | own profile (name/avatar), per-org capability summary, password/email change, theme, sign-out, delete account — reached via the shell avatar, not the nav |
| global navbar | search | org switcher, notifications slot (P5), profile/logout |

Every screen spec includes loading / empty / error / 403 states.

---

## 7. Configurable Workflow Design

- **Templates → instances by snapshot copy.** `checklist_template_items` →
  `project_checklist_items`; `signatory_steps` → `document_signatory_steps`.
  Template edits never mutate live instances.
- **Conditional rules** live in `rule_json` / `condition_json`, evaluated at
  instantiation server-side, e.g.:
  `{"include_if_event_type": "webinar_intl"}` → RFP step only for
  international webinars; `{"due_days_before_event": 15}` → computed
  `due_date` from `project.target_date`.
- **Duty schedule** per `school_year`: `weekday → member_ids`; drives
  `duty_type` and compliance denominators.
- **Doc-type → chain binding:** `documents.doc_type` + `project.event_type`
  selects the matching `signatory_chains` row; owner can override at creation.
- **Org defaults:** new orgs start empty; CCS seed templates (§9) are inserted
  as ordinary template rows for the CCS tenant only — the *seeder* is a
  script, the *templates* are data.

---

## 8. Security & Privacy

### 8.0 Threat model (STRIDE)

| Boundary | Threat | Control |
|---|---|---|
| Client ↔ API | Spoofing (fake user) | Supabase JWT verify every request; short token TTL + refresh |
| | Tampering | HTTPS only; HSTS |
| | Repudiation | `audit_log` for all sensitive mutations |
| | Info disclosure | Error envelope, no stack traces; field allowlists on responses |
| | DoS | Rate limits on minting/auth-adjacent endpoints; page-size caps; 5MB uploads |
| | Elevation | `authorize()` dependency on every route; role matrix enforced server-side |
| API ↔ Supabase | Service-key theft = full access | Key in env only, never bundled/logged; rotate on suspicion |
| | Direct table access | RLS deny-by-default + `is_org_member`/`has_org_role` policies |
| Uploads | Malware/polyglot files | Allowlist mime + magic-byte check + size cap; EXIF strip |
| | Public photo leak | Private buckets, signed URLs ≤15 min, org-path isolation |
| Invite/join links | Link sharing/abuse | `max_uses`, `expires_at`, code entropy, audit on redeem |
| OAuth callback | CSRF/state confusion | Supabase PKCE/state handling; redirect allowlist in Supabase config |

### 8.1 RBAC

Matrix in §2 enforced by `authorize(org_id, min_role)` FastAPI dependency;
membership + role + `status='active'` resolved per request (no client claims
trusted). Owner-only mutations: member roles, positions, duty schedule,
templates, invites, org settings.

### 8.2 Tenant isolation

- App layer: every query filters `org_id` resolved from the *authorized* path
  param — never from client-supplied body alone.
- DB layer: RLS policies on all org-scoped tables (§4) — deny-by-default for
  non-service access.
- Storage: objects under `{org_id}/…`; signed URL minting re-checks org
  membership.
- **Acceptance test (mandatory):** automated suite where org-B tokens attempt
  every read/write endpoint against org-A IDs → all 403/404.

### 8.3 Sensitive data handling

- **Classification:** HIGH = service key, signature-step status, document/
  journal photos, audit log; MED = member names/emails, positions, financial
  figures in project details; LOW = org name, template labels.
- Private buckets only; signed download URLs minted post-authz (TTL ≤ 15 min).
- No HIGH/MED fields in logs, analytics, error messages, or emails.

### 8.4 Transport & session security — **decision**

**Bearer JWT in `Authorization` header** (Supabase access token managed by
supabase-js; refresh handled by the SDK).

- *Why not httpOnly cookies:* web and API are **separate Vercel origins** —
  cross-site cookies need `SameSite=None; Secure` + a CSRF-token layer;
  Bearer removes the CSRF class entirely.
- *Tradeoff acknowledged:* tokens live in supabase-js storage
  (localStorage-adjacent) → XSS is the residual risk. Mitigations: strict CSP
  (no inline scripts, allowlist origins), React auto-escaping everywhere (no
  `dangerouslySetInnerHTML` on user data), short access-token TTL, dependency
  audit.
- *Mobile note:* Expo phase uses secure-store — same Bearer pattern carries.
- CORS: single origin = web deployment URL (+ localhost dev). HTTPS/HSTS only.

### 8.5 Audit trail

Append-only `audit_log` (revoked update/delete) written by the service layer
on: document movements, signature-step changes, member approve/remove/role
changes, position/duty/template edits, post-day journal/attendance edits,
invite mints/redeems, join decisions, exports.

### 8.6 Upload safety

Signed-upload mint validates: member active, mime ∈ {jpeg,png,webp},
declared size ≤ 5MB, path scoped `{org_id}/{entry_id}/{uuid}` (server-chosen,
never client path). On entry create: object existence + magic bytes verified
server-side; EXIF stripped (client-side pre-strip via canvas re-encode as
primary path given 10s function limit — see OQ).

### 8.7 Data lifecycle

- School-year rollover: previous `school_years.is_current=false`; its
  positions/duty/journal remain read-only history.
- Member removal: `status='removed'` (soft) — journal/audit retained.
- **Account deletion:** `DELETE /me` never hard-deletes — `org_members` and
  the journal/attendance/duty composite FKs reference `profiles`, so
  removing the auth user would orphan history. Instead: all memberships →
  `removed`, profile anonymized (`display_name='Former member'`, avatar
  cleared + object deleted), auth user **banned** via admin API. Sole owner
  of any org → `409` until the org is deleted or ownership handed off.
- Org offboard: owner export (§5 #39) then hard-delete org → cascades.
- No auto-deletion of journals/photos in MVP; retention review at P5.

### 8.8 Secrets & config

`.env.example` committed (placeholder keys); `.env*` gitignored except
example. Supabase URL/anon key client-side (public by design); **service-role
key exists only in API env**. Handbook credentials never copied anywhere;
recommend rotating the council Gmail password (currently in git history).

### 8.9 Input validation & query safety

Pydantic models validate every body/query/path at the boundary; DB access
only via SQLModel/SQLAlchemy parameterized statements; response schemas
allowlist fields (no ORM leak-through of sensitive columns).

### 8.10 Platform hardening

Web deployment headers: CSP (`default-src 'self'` + Supabase origins),
HSTS, `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`,
`Referrer-Policy strict-origin-when-cross-origin`. Rate limits (see OQ for
serverless store): join-requests 10/15min, invite mint 20/hr, photo-sign
60/hr per user, login handled by Supabase limits. Dependency hygiene: pinned
`package-lock.json` + `requirements.txt`/lockfile; `npm audit` + `pip-audit`
in CI at P5.

---

## 9. Seed Data Plan (CCS tenant)

| Handbook source | Seed artifact |
|---|---|
| §3 Concept paper checklist | `checklist_templates` "Concept Paper" (paper track): summary letter, board resolution, concept paper, speaker CV, speaker certificates, outside-supplier justification (conditional) |
| §4 + §5 Signatory routing | `signatory_chains` "Standard Concept Paper": SSC President → SAS routing → School Director; `condition_json` steps: Marketing (merch), RFP (intl webinar). Chain "Board Resolution" = same minus SSC President |
| §7 Financial report | `checklist_templates` "Financial Report" + rule `due_days_after_event: 7` (CHECK submission) |
| §9 Venue reservation | `checklist_template_items` hints (GSD in-person; 3-day pencil-booking lapse; target papers done 1 month out) |
| §10 Events checklist | `checklist_templates` "Event Logistics" (logistics track): committees, tarpaulin, food, venue, sound/mic, transport, registration, certificates, pubmats |
| §12 Outside events | `checklist_templates` "Outside Event Pack": CHED letter (`due_days_before_event: 15`, two-channel hard+email), participant list + parents' consent, curriculum forms, medical letter, van request |
| §13 CES | `signatory_chains` "CES Concept Paper" incl. Sir Bennyl step + prior-activity-reports note in hint |
| §14 Duty roster | `duty_schedules` rows SY 2026–2027 (Mon–Fri named officers) |
| §15 Quick reference | `org_contacts` rows (who-to-ask directory) |
| §2 pending handover items | NOT seeded — real operational data, entered by officers |

Names/offices appear **only** in these seed rows for the CCS org — never in
schema, code, or shared defaults.

---

## 10. Non-Functional Requirements

- **Timezone:** all `date` semantics in `Asia/Manila`; server computes "today"
  per org tz (org-level setting, default Asia/Manila).
- **Mobile-first:** fully usable at 360px width; touch targets ≥ 44px;
  camera-first photo capture (`input capture` / file picker).
- **Performance:** p95 API < 500ms reads; dashboard < 2.5s LCP on mid-tier
  Android over campus Wi-Fi; lists paginated (default 20/max 100).
- **Vercel limits:** functions ≤10s (hobby) → no binary pass-through; uploads
  direct-to-Storage via signed URL; EXIF strip client-side or async (OQ).
- **Availability:** degrade gracefully offline → read-only cached shell is a
  P5+ nicety, not required.
- **Auditability:** every sensitive mutation writes `audit_log`.
- **i18n:** copy in English; PH-context terminology kept (concept paper,
  signatory, duty).

---

## 11. Phased Roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 Scaffold** | v2 monorepo: `web/` (Vite+React+TS), `api/` (FastAPI), Supabase project, env split, `/health`, auth flow end-to-end, two Vercel deployments | login works in prod deploys |
| **P1 Orgs & people** | orgs CRUD, invites, join requests, members, positions/org chart, duty schedule | owner can onboard a roster |
| **P2 Daily loop** | journal entries, signed upload/download URLs, attendance days + views, "no tasks" | officer files a full week end-to-end |
| **P3 Projects & papers** | projects, checklist templates + instantiate, checklist checkoff, documents + movements + photo evidence | a concept paper tracked door-to-door |
| **P4 Workflows** | signatory chains + conditional instantiation, template admin editors, project↔doc linking | intl-webinar RFP step appears conditionally |
| **P5 SaaS polish** | audit views, export, orphaned-upload sweeper, rate-limit hardening, dep audits in CI, retention rules | tenant #2 test org self-onboards |
| **P6 Mobile** | Expo RN app consuming identical `/api/v1` contract; secure-store tokens | officers file journal from native app |

---

## 12. Acceptance Criteria (per feature)

- **Auth/onboarding:** new user → create org → lands as owner; invitee redeems
  link → active member without approval step; join request → owner approve →
  member sees org data; rejected → sees nothing. Google OAuth works for both.
- **Tenancy:** automated cross-org test — org-B JWT cannot GET/PATCH/POST any
  org-A resource (API + storage); RLS blocks direct table reads for
  non-members.
- **Attendance:** officer files journal → day shows `documented`; officer
  files "no tasks" → `declared_no_tasks`; scheduled weekday with neither →
  appears as unaccounted in roster view; off-day entry → `extra` flag; weekly
  % matches roster math.
- **Journal:** photo upload end-to-end (sign → PUT → entry → signed-view);
  non-image upload rejected; >5MB rejected; org-A photo URL cannot be minted
  by org-B member.
- **Projects:** create project w/ both tracks → both checklists instantiate
  from matching templates; template edit post-instantiate does NOT alter the
  project; due_date computed from `due_days_before_event`.
- **Logbook:** movement appended → timeline shows latest location; chain
  instantiated → steps pending → advance → signed w/ actor+time; skipped step
  requires note; UPDATE/DELETE on movements fails at DB level.
- **Workflows:** `event_type=webinar_intl` doc gets RFP step; `ces` doc gets
  Bennyl step; standard doc gets neither.
- **Configurability:** owner creates custom position/template/chain/duty via
  Settings → usable in features immediately; org-B never sees org-A templates.
- **Security:** audit rows exist for every sensitive mutation; error
  responses never contain stack traces; security headers present on web.

---

## 13. Open Questions

1. **Adviser role shape** — distinct `adviser` role (chosen) vs officer +
   permission flag? Confirm with CCS adviser expectations.
2. **EXIF stripping** — client-side canvas re-encode (free-tier friendly,
   recommended) vs server-side with a longer-timeout function/container.
3. **Rate-limit store** — Vercel serverless has no shared memory: Supabase
   table counter vs Upstash Redis vs skip-in-MVP. MVP decision needed at P5
   (endpoints listed, mechanism open).
4. **Notifications** — none in MVP (in-app "today" card only). Email/push
   deferred — confirm officers will voluntarily open the app.
5. **Google OAuth** — requires Supabase Google provider config + school
   Google Workspace domain policy? Any-restriction vs `@school.edu` domain
   allowlist.
6. **Multi-org membership** — one user in several orgs is supported by
   schema; confirm desired (officers in CCS + JPCS etc.).
7. **Document file attachments** — MVP tracks *physical* paper + photos only;
   attach actual PDF copies later?
8. **Position↔member constraint** — `positions.holder`/`duty_schedules.
   member_id` reference `user_id`; composite FK to `(org_id,user_id)` in
   `org_members` enforceable at DB level — add in migration polish.
9. **`event_type` taxonomy** — seeded set (`seminar, competition, outside,
   ces, webinar_intl, merch`) — org-editable vocabulary or fixed enum?
10. **Attendance edits** — should `unaccounted` days be backfillable by
    officers next day, or owner-only retro-fix? (Spec assumes next-day
    filing allowed as `extra`/late — flag for confirmation.)
