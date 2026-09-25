-- Checklist item assignment: a member can own a specific task within a project.
-- Nullable; no FK (matches projects.owner_id — membership is validated in the
-- route layer via require_user_in_org).
alter table project_checklist_items
  add column assignee_id uuid null;
