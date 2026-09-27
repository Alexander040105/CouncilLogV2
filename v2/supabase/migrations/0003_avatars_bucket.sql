-- 0003: public `avatars` bucket.
-- Public read is deliberate: avatar_url renders as a plain <img src> inside
-- member lists/rosters, where per-image signed URLs don't fit. Avatars are
-- low-sensitivity (visible to all org members anyway). Journal stays private.
-- Uploads go through service-role-minted signed URLs, so no storage.objects
-- write policy is needed for regular users.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
