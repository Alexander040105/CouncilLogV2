-- 0011: project_checklist_items.created_at — parity with every other table.
-- The flat checklist-items list ("needs you" / agenda) orders by due_date,
-- then creation time. Existing rows all get the migration timestamp — the
-- tiebreak is only meaningful between rows created after this runs.

alter table project_checklist_items
  add column if not exists created_at timestamptz not null default now();
