-- 0012: covering index for the flat "needs you" / agenda query —
-- GET /orgs/{o}/checklist-items filters (org_id, assignee_id, done=false).
-- Partial like tasks_by_assignee (0010): only open items are hot-listed.
create index if not exists pci_by_assignee
  on project_checklist_items (org_id, assignee_id)
  where done = false;
