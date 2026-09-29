-- 0008: platform admins + org archive
--
-- profiles.is_admin — a platform-wide flag: admins act as owner in EVERY org
-- (deps.authorize() bypass) and are the only ones who can restore an archived
-- org. Keyed by profile/user id so it survives email changes.
--
-- organizations.archived_at — soft delete. Archived orgs are invisible and
-- inaccessible to all members (authorize() → 404) but keep every row, so a
-- system admin can restore them intact. Nothing cascades away.

alter table profiles add column if not exists is_admin boolean not null default false;
alter table organizations add column if not exists archived_at timestamptz;

-- seed the first platform admin. The auth user already exists; the upsert
-- also covers a profile row that hasn't been lazily created yet (display_name
-- is NOT NULL). No-op if the email is unknown.
insert into profiles (id, display_name, is_admin)
select id, email, true
from auth.users
where lower(email) = 'alexanderjonsolis0401@gmail.com'
on conflict (id) do update set is_admin = true;
