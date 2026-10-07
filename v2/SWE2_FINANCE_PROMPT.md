# Prompt for SWE-2 Max: org bankbook + per-project budget tracker with receipts and FRF export

Self-contained implementation prompt for a finance feature: org-level bankbook ledger, per-project budgets backed by an uploaded board-resolution scan, vendor-grouped expenses with downloadable receipt uploads, and an FRF-formatted report view plus .docx export.

You are working in the repository at `D:\63947\Documents\GitHub\CouncilLogV2`. The app is a FastAPI + SQLModel (async SQLAlchemy, asyncpg → Supabase Postgres) backend under `v2/api`, deployed to Vercel serverless, with a React+Vite web app (`v2/web`), a static landing page (`v2/landing`), and an Expo mobile app (`v2/mobile`). API routers live under `v2/api/app/routers/`, mounted at `/api/v1`. Supabase SQL migrations live in `v2/supabase/migrations/` (currently numbered through `0012`; your new migration is `0013_finance.sql`).

## Feature: org bankbook + per-event budget tracker

Student councils track two things financially:

1. **The bankbook** — one running ledger per organization recording deposits and withdrawals with dates, a running balance, and a free-text source tag (real reports cite lines like "CCS Bankbook as of 30Jun26 TAX" — `TAX`/`CSW` are fund-source tags).
2. **Per-event budgets** — a `Project` row IS an event in this app (it has `title`, `event_type`, `target_date`). Each event gets a budget: an amount **withdrawn from the bankbook** and authorized by a **board resolution**. The resolution comes in two forms, either or both:
   - `resolution_id` → a `documents` row with `doc_type='board_resolution'` (that doc_type already exists — the paper being tracked through signatories)
   - `resolution_path` → an **uploaded scan/photo/PDF of the signed resolution** (the real-world artifact is a printed page with signatures). The upload matters: it's how the officer entering the budget verifies the allocated amount is the amount the resolution actually authorized — governance rule in the resolution text itself: "no funds shall be released without a resolution."

   Officers record itemized expenses, each optionally grouped under a vendor name and carrying uploaded receipt files. When the event ends, the budget is "closed" and the remaining money is deposited back into the bankbook as a new transaction.

This powers the council's **Financial Report Form (FRF)** — a school-mandated docx whose structure is:

- Activity details (title, date, nature, time, venue — most from the project row)
- Source of Fund line (bankbook label + balance) and **Total Fund** = allocated/withdrawn amount
- **Less Expenses**: items grouped by vendor/store with per-item amounts and per-vendor subtotals
- Total Expenses, Total Remaining Fund
- A note stating the remaining fund was redeposited into the bankbook on a given date, plus the resulting balance
- Signature block: Auditor (prepared by), Treasurer (noted by), President (recommending), Adviser (approved) — resolve these names best-effort from `positions` (current school year, case-insensitive title match) → `profiles.display_name`; blank if unfilled

Requirements: receipts AND the resolution file must be **downloadable** (officers attach them to the printed report), and the report aid must include BOTH an in-app print/copy view AND a generated `.docx` download.

## Conventions to mirror (read these first)

- `api/app/routers/daily.py` — journal entries + photo signing flow; `PhotoSign` → `storage.signed_upload_url` → client PUT → attach `storage_path` verified with `object_head` + `check_magic_bytes` + `{org_id}/` prefix check. `check_rate_limit` usage at line ~61.
- `api/app/routers/projects.py` — `authorize(min_role)`, `envelope`/`page_params`, `add_deduped`/`deduped_response` idempotent create, `audit()` calls, `fan_out_*` notifications.
- `api/app/models.py` — column patterns: `created_at` server_default `func.now()`, composite-`org_id` scoping, `client_request_id` + `UniqueConstraint("org_id","client_request_id")` for offline idempotency.
- `api/app/services/storage.py` — signed upload/download minting, `ALLOWED_MIME`, `_MAGIC` byte signatures.
- `api/tests/test_ux_edits.py` — test harness: sqlite in-memory engine, per-table create, `Membership` construction, storage monkeypatched. Follow its `session` fixture + `_member`/`_project` helpers.
- `web/src/pages/*.jsx` + `web/src/components/ui.jsx` — page structure, `get/post/patch/del` from `lib/api.js`, `useQuery`/`useMutation`, Chips/cards/modals. `PhotoPicker.jsx` for the upload widget (extend to accept PDF).
- `v2/supabase/migrations/0010_tasks_notifications.sql` — DDL + `enable row level security` + select-only `is_org_member(org_id)` policies pattern.

## Decisions (already made — implement these)

- Budgets attach to `projects` (one budget max per project).
- Money is stored as **`bigint` centavos** everywhere — never floats. API accepts `amount_centavos`/`allocated_centavos` integers; the web UI converts peso input (`Math.round(parseFloat(x) * 100)`) and formats with `Intl.NumberFormat('en-PH', {style:'currency', currency:'PHP'})`.
- Permissions: **member+ reads, officer+ writes** for expenses/budgets/bankbook transactions. Corrections follow the journal rule: creator on their own same-day record, or `owner` anytime (see `_editable` in daily.py).
- Receipts AND resolution scans: jpeg/png/webp/**pdf**, ≤5MB, private `journal` bucket under `{org_id}/...`.
- A budget may carry an uploaded resolution file, a link to a tracked `board_resolution` document, both, or (with a UI warning, since governance says funds need a resolution) neither.
- Report aid: in-app FRF-formatted page **and** server-generated `.docx` (python-docx).

## Schema — `v2/supabase/migrations/0013_finance.sql`

```sql
create table project_budgets (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  allocated_centavos  bigint not null check (allocated_centavos > 0),
  source_label        text,                       -- 'TAX','CSW',… fund-source tag
  resolution_id       uuid references documents(id) on delete set null,
  resolution_path     text,                       -- uploaded scan of the signed resolution
  resolution_mime     text,
  resolution_byte_size int,
  status              text not null default 'open' check (status in ('open','closed')),
  note                text,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  closed_at           timestamptz
);
create unique index budgets_one_per_project on project_budgets (project_id);
create index budgets_by_org on project_budgets (org_id, status);

create table fund_transactions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  kind              text not null check (kind in ('deposit','withdrawal')),
  amount_centavos   bigint not null check (amount_centavos > 0),
  transacted_on     date not null,
  source_label      text,
  note              text,
  budget_id         uuid references project_budgets(id) on delete set null,
  created_by        uuid not null,
  created_at        timestamptz not null default now()
);
create index fund_txns_by_org on fund_transactions (org_id, transacted_on desc, created_at desc);
create index fund_txns_by_budget on fund_transactions (budget_id) where budget_id is not null;

create table budget_expenses (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  budget_id         uuid not null references project_budgets(id) on delete cascade,
  vendor            text,                          -- groups items in the FRF ('MR. DIY')
  item              text not null,                 -- 'Lunch box (22.00 x 10pcs)'
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

alter table project_budgets  enable row level security;
alter table fund_transactions enable row level security;
alter table budget_expenses   enable row level security;
alter table expense_receipts  enable row level security;
-- members read their org's rows; all writes go through the service role
create policy budgets_select  on project_budgets  for select using (is_org_member(org_id));
create policy fund_select     on fund_transactions for select using (is_org_member(org_id));
create policy expenses_select on budget_expenses   for select using (is_org_member(org_id));
create policy receipts_select on expense_receipts  for select using (is_org_member(org_id));
```

Add matching SQLModel classes to `app/models.py` following existing patterns (`Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))`, etc.).

## API — new router `app/routers/finance.py` (register in `main.py`)

**Bankbook:**
- `GET /orgs/{o}/fund` (member+) → `{balance_centavos, transactions: [...]}` — transactions `.limit(500)` desc by `transacted_on`, each including `project_title` when `budget_id` links through to a project.
- `POST /orgs/{o}/fund/transactions` (officer+) → `{kind, amount_centavos, transacted_on?(default org_today()), source_label?, note?}` — audit `fund.transaction`.
- `PATCH`/`DELETE /orgs/{o}/fund/transactions/{id}` — same-day creator or owner; **422 `LINKED_TRANSACTION` if `budget_id` is set** — linked rows change only via the budget flow.

**Budgets:**
- `POST /orgs/{o}/fund/resolution-sign` (officer+, 201) → `{mime, byte_size}` → rate-limit `receiptsign:{user.id}` bucket reused, path `{org_id}/resolutions/{uuid4()}`; returns `{path, upload_url}`. Used BEFORE the budget exists — the file is uploaded first, then referenced at budget create.
- `POST /orgs/{o}/projects/{p}/budget` (officer+, 201) → `{allocated_centavos, resolution_id?, resolution: {storage_path, mime, byte_size}?, source_label?, note?}`. In one transaction: insert budget + insert withdrawal `fund_transaction` (`kind='withdrawal'`, `transacted_on=org_today()`, `budget_id`, note `Withdrawal for "{project.title}"`). 409 `BUDGET_EXISTS` if the project has one. If `resolution_id` given: must be a `documents` row in this org; 422 `WRONG_DOC_TYPE` if `doc_type != 'board_resolution'`. If `resolution` given: `{org_id}/` prefix check + `object_head` + `check_magic_bytes`, then copy to `resolution_path/mime/byte_size` columns.
- `GET /orgs/{o}/projects/{p}/budget` (member+) → `{budget, spent_centavos, remaining_centavos, withdrawal_txn, return_txn?, expenses: [{...row, receipts: [...]}]}` — `budget` includes `resolution_id`, `resolution_path` presence (`has_resolution_file`), and the linked document's title when set. 404 if none (web uses this to show the setup form).
- `GET /orgs/{o}/budgets` (member+) → all org budgets joined with project title, computed spent/remaining — powers the Budget page.
- `PATCH /orgs/{o}/budgets/{id}` (officer+) → `allocated_centavos` (sync the linked withdrawal txn's `amount_centavos`), `source_label`, `note`, `resolution_id` (tri-state via `model_fields_set`), and `resolution: {storage_path, mime, byte_size} | null` (tri-state — replaces the file; old path deleted best-effort after commit). Refuse on `closed` budgets (422 `BUDGET_CLOSED`). Audit `budget.updated`.
- `GET /orgs/{o}/budgets/{id}/resolution/url` (member+) → `{download_url}` via `storage.signed_download_url(budget.resolution_path)`; 404 `NO_RESOLUTION_FILE` when unset.
- `POST /orgs/{o}/budgets/{id}/close` (officer+) → `remaining = allocated − spent`; 422 `OVERSPENT` if negative (message tells the officer to raise the allocation first). If `remaining > 0` insert a deposit `fund_transaction` (`budget_id`, `transacted_on=org_today()`, note `Returned remaining fund — "{project}"`); set `status='closed'`, `closed_at`. Response includes the created txn and post-deposit bankbook balance so the UI can show it.
- `DELETE /orgs/{o}/budgets/{id}` (officer+) → only when zero expenses exist (else 422 — close it instead); deletes the withdrawal txn + best-effort delete `resolution_path`; audit `budget.deleted`.

**Expenses:**
- `POST /orgs/{o}/budgets/{id}/expenses` (officer+, 201) → `{vendor?, item, amount_centavos, spent_on?=org_today(), note?, client_request_id?}` — dedupe via `add_deduped`; 422 `BUDGET_CLOSED` on closed budgets. Overspending is ALLOWED (remaining just goes negative; closing is what's blocked).
- `PATCH`/`DELETE /orgs/{o}/expenses/{id}` — same-day creator or owner; DELETE removes receipt rows + best-effort `storage.delete_object` after commit.
- `POST /orgs/{o}/expenses/{id}/receipts/sign` (officer+, 201) → `{mime, byte_size}` → rate-limit `receiptsign:{user.id}` 60/hr; path `{org_id}/receipts/{expense_id}/{uuid4()}`; returns `{path, upload_url}` like `sign_photo`.
- `POST /orgs/{o}/expenses/{id}/receipts` (officer+, 201) → `{storage_path, mime, byte_size}` — org-prefix check + `object_head` + `check_magic_bytes` (same trio as journal photos).
- `DELETE /orgs/{o}/expenses/{e}/receipts/{r}` — same-day creator-or-owner on the expense; best-effort storage delete.
- `GET /orgs/{o}/receipts/{r}/url` (member+) → `{download_url}` via `storage.signed_download_url`. The UI fetches URLs lazily per receipt.

**Report:**
- `GET /orgs/{o}/projects/{p}/financial-report` (member+) → JSON shaped for the FRF:
  ```
  {project: {title, event_type, target_date},
   fund: {source_label, allocated_centavos, withdrawn_on},
   resolution: {document_id?, document_title?, has_file}? ,
   expenses_by_vendor: [{vendor|null, items:[{item, amount_centavos, spent_on}], subtotal_centavos}],
   totals: {spent_centavos, remaining_centavos},
   return: {deposited_on, amount_centavos, balance_after_centavos}? ,
   signatories: {auditor?, treasurer?, president?, adviser?}}
  ```
  `balance_after_centavos` = bankbook balance computed at the return transaction (sum deposits − withdrawals `transacted_on <= txn.transacted_on` including it). Signatories resolved from `positions` (current `school_years.is_current` SY, `ilike` title match on auditor/treasurer/president/adviser) → `profiles.display_name`; `null` when absent.
- `GET /orgs/{o}/projects/{p}/financial-report.docx` (member+) → generate with `python-docx`, return `Response(content=..., media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document', headers={'Content-Disposition': f'attachment; filename="{slug}-financial-report.docx"'})`. Layout = the FRF structure above: title heading, activity details table, Source of Fund line, vendor-grouped expense table with subtotals, totals block, the redeposit note sentence, signature block. It does NOT need to be pixel-perfect — clean tables matching the field order.

**Storage change:** in `services/storage.py` add `"application/pdf"` to `ALLOWED_MIME` and `b"%PDF-"` to `_MAGIC`; update the `BAD_FILE_TYPE` message to mention pdf.

**Dependency:** `python-docx==1.1.2` in `requirements.txt` (stable/well-aged).

## Web (`v2/web`)

- `lib/money.js` — `peso(centavos)` Intl PHP formatter; `toCentavos(str)` → int or `null` on invalid input.
- `pages/Budget.jsx` (`/budget`, nav item in `AppShell.jsx`): current balance card, add-transaction form (kind, peso amount, date defaulting today, source label, note), transactions table with linked-project names, and a budgets table (project, allocated, spent, remaining, open/closed chip, link). Empty states must say why and what to do next ("No transactions yet — record the bankbook's opening balance as a deposit first.").
- `pages/ProjectDetail.jsx` — add a Budget section: no budget → setup form (allocation amount, **"Attach board resolution"** — file picker accepting images + PDF that uploads the scan via `resolution-sign`, OR a dropdown to pick an existing tracked `board_resolution` document — plus a visible note when neither is provided: "Budgets are normally backed by a board resolution — upload the signed resolution or link the tracked document so the amount can be verified."); budget exists → allocated/spent/remaining summary, the resolution file with a view/download button (lazy `GET .../resolution/url`), vendor-grouped expense list with add-expense form, receipt upload per expense (extend `PhotoPicker` to `accept="image/jpeg,image/png,image/webp,application/pdf"`), receipt download buttons (lazy `GET .../url` then `window.open`), and **"Close budget"** which first shows a confirmation displaying the computed remaining amount and the deposit that will be recorded (preview before commit — repo UX rule).
- `pages/FinancialReport.jsx` (`/projects/:id/report`): renders the report JSON in FRF field order with peso formatting, a **Download .docx** button (fetch blob → `URL.createObjectURL` → `a.download`), per-receipt download buttons AND a resolution-file download button, and a Print button (`window.print()`). Add a `@media print` block in `index.css` hiding the AppShell chrome (`aside`, `header`) so the printed page is clean.
- Register routes in `main.jsx`; use existing `ui.jsx` components and the app's neo-brutalist tokens.

## Tests — `api/tests/test_finance.py`

Mirror `test_ux_edits.py` fixture/helpers (copy its `session` fixture + `_member`; extend `TABLES` with the 4 new tables — the JSONB-compile hook isn't needed for these tables, but `flags`/`payload` server_defaults still need clearing if you include `Project`/`Notification` tables — follow the existing pattern). Cover:

- Creating a budget inserts a linked withdrawal transaction and expense create is idempotent across retries (`client_request_id`).
- `GET fund` balance math (deposits − withdrawals), `transacted_on` ordering.
- Resolution attach at create: `{org_id}/`-prefix violation → 422 `BAD_PATH`; pdf magic bytes accepted (monkeypatch `object_head` → `b"%PDF-..."`); `resolution/url` returns signed URL when set, 404 `NO_RESOLUTION_FILE` when not; PATCH tri-state replaces the file and deletes the old path (assert via `fake_storage`'s deleted list).
- `resolution_id` with `doc_type != 'board_resolution'` → 422 `WRONG_DOC_TYPE`.
- Expense add on a closed budget → 422 `BUDGET_CLOSED`; member (non-officer) writes → 403.
- Overspend allowed on add; `close` → 422 `OVERSPENT`; after raising allocation via PATCH, close succeeds and inserts the deposit txn with correct `amount_centavos`.
- `PATCH`/`DELETE` guards: non-author member editing another's expense → 403; author same-day OK; owner anytime OK.
- Deleting a `budget_id`-linked fund transaction → 422 `LINKED_TRANSACTION`.
- Report JSON: vendor grouping + subtotals + `balance_after_centavos`; a `Position` titled "Auditor" yields the holder's name in `signatories.auditor`; `resolution` block reflects `resolution_id`/`has_file`.
- Docx endpoint: returns 200 with the right `Content-Disposition` header and non-empty body (call the handler directly; don't parse the docx).

## Deploy note for the operator

Prod DB must have migrations `0011`, `0012`, and now `0013` applied in order via the Supabase SQL editor before the code deploys (same ordering rule as the `created_at` fix: schema first, then code).

## Repo rules (hard requirements)

- **No AI attribution/branding anywhere** — code, comments, commit messages, docs (`AGENTS.md`). Commit messages are the change description only.
- UX rules from `AGENTS.md`: plain language, empty/error states name the cause + next step, preview before commit (the close-budget confirmation is mandatory).
- Do not commit — leave changes in the working tree.

## Verification

```
cd v2/api && .venv/Scripts/python -m pytest tests -q     # all green (104 baseline + new finance tests)
cd v2/web && npm run build                               # must compile clean
```
