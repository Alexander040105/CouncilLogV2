-- 0009: daily-loop corrections.
-- Movements were spec'd append-only (0001 revoked UPDATE/DELETE from public).
-- The product now allows corrections — the mover may edit/delete their own
-- same-day record and owners may correct any, via the API.
--
-- The revoke never applied to the API itself (it connects as postgres, the
-- table owner, which bypasses RLS/revokes). These grants re-arm the
-- privileges for non-owner roles — Supabase client-side reads stay
-- select-only via RLS regardless.
grant update, delete on document_movements to service_role;
grant update, delete on document_movements to authenticated;

-- journal_entries and attendance_days were never revoked; nothing to grant.
-- New API behavior (audit-logged in the app tier):
--   DELETE /orgs/{org}/journal/{id}          — author same-day or owner
--   DELETE /orgs/{org}/attendance/{day}      — retract declared_no_tasks
--   PATCH|DELETE /orgs/{org}/documents/{d}/movements/{m}
