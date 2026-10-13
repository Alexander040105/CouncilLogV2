-- Dailies can tag a specific paper, not just a project: a member who spent
-- the day chasing a document can point the entry at it. journal_entries is
-- already RLS-protected from 0001, so the new column needs no new policy.
alter table journal_entries
  add column if not exists document_id uuid references documents(id);

create index if not exists journal_entries_document_id_idx
  on journal_entries (document_id);
