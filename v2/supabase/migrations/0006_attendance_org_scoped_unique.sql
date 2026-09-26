-- attendance_days: uniqueness must be per (org, member, day).
-- The original unique(member_id, day) blocked a user who belongs to more
-- than one org from filing attendance in their second org on the same day
-- (409 on insert, or worse: upsert silently reused the other org's row).
alter table attendance_days
  drop constraint attendance_days_member_id_day_key;

alter table attendance_days
  add constraint attendance_days_org_member_day_key
  unique (org_id, member_id, day);
