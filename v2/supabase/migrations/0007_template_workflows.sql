-- 0007: template workflows — flags columns + safe template deletion.
--
-- `flags` on projects/documents carries the booleans that `include_if_flag`
-- rules evaluate at instantiation (e.g. {"has_merch": true} inserts the
-- Marketing step, {"off_campus": true} lands the outside-event pack).
-- project_checklist_items.template_id becomes `on delete set null` so
-- deleting a checklist template preserves the generated checklists —
-- items are snapshots; only the provenance pointer clears (spec §3.6).

alter table projects
  add column flags jsonb not null default '{}'::jsonb;

alter table documents
  add column flags jsonb not null default '{}'::jsonb;

alter table project_checklist_items
  drop constraint project_checklist_items_template_id_fkey;

alter table project_checklist_items
  add constraint project_checklist_items_template_id_fkey
  foreign key (template_id) references checklist_templates(id) on delete set null;
