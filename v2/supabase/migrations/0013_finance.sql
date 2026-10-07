-- 0013: finance — org bankbook ledger + per-project budgets + expense receipts.
--
-- fund_transactions is the bankbook: deposits in, withdrawals out, running
-- balance = deposits - withdrawals. Budget-linked rows (budget_id set) are
-- written only by the budget flow — manual edits would fork the ledger.
-- project_budgets: one per project; allocated = the amount the board
-- resolution authorized withdrawn. close() writes the return deposit.
-- resolution_id links the tracked paper doc; resolution_path is an uploaded
-- scan of the signed page — either, both, or neither.

create table project_budgets (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  project_id           uuid not null references projects(id) on delete cascade,
  allocated_centavos   bigint not null check (allocated_centavos > 0),
  source_label         text,
  resolution_id        uuid references documents(id) on delete set null,
  resolution_path      text,
  resolution_mime      text,
  resolution_byte_size int,
  status               text not null default 'open' check (status in ('open','closed')),
  note                 text,
  created_by           uuid not null,
  created_at           timestamptz not null default now(),
  closed_at            timestamptz
);
create unique index budgets_one_per_project on project_budgets (project_id);
create index budgets_by_org on project_budgets (org_id, status);

create table fund_transactions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  kind            text not null check (kind in ('deposit','withdrawal')),
  amount_centavos bigint not null check (amount_centavos > 0),
  transacted_on   date not null,
  source_label    text,
  note            text,
  budget_id       uuid references project_budgets(id) on delete set null,
  created_by      uuid not null,
  created_at      timestamptz not null default now()
);
create index fund_txns_by_org on fund_transactions (org_id, transacted_on desc, created_at desc);
create index fund_txns_by_budget on fund_transactions (budget_id) where budget_id is not null;

create table budget_expenses (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  budget_id         uuid not null references project_budgets(id) on delete cascade,
  vendor            text,
  item              text not null,
  amount_centavos   bigint not null check (amount_centavos > 0),
  spent_on          date not null,
  note              text,
  recorded_by       uuid not null,
  client_request_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index expenses_by_budget on budget_expenses (budget_id, spent_on, created_at);
create unique index expenses_client_req on budget_expenses (org_id, client_request_id)
  where client_request_id is not null;

create table expense_receipts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  expense_id   uuid not null references budget_expenses(id) on delete cascade,
  storage_path text not null unique,
  mime         text not null,
  byte_size    int not null,
  created_at   timestamptz not null default now()
);
create index receipts_by_expense on expense_receipts (expense_id);

alter table project_budgets   enable row level security;
alter table fund_transactions enable row level security;
alter table budget_expenses   enable row level security;
alter table expense_receipts  enable row level security;
-- members read their org's rows; all writes go through the service role
create policy budgets_select  on project_budgets   for select using (is_org_member(org_id));
create policy fund_select     on fund_transactions for select using (is_org_member(org_id));
create policy expenses_select on budget_expenses   for select using (is_org_member(org_id));
create policy receipts_select on expense_receipts  for select using (is_org_member(org_id));
