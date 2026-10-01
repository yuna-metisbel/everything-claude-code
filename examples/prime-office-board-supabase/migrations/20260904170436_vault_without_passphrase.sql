-- The owner asked to drop the team passphrase for media accounts: the board's URL
-- is only shared with staff, and the extra step was not worth it to them.
-- Credentials are now stored as given, readable by anyone who can sign in.
-- The table is empty, so nothing needs migrating.
alter table public.vault add column if not exists login_id text not null default '';
alter table public.vault add column if not exists password text not null default '';
alter table public.vault drop column if exists enc;

drop table if exists public.vault_config;
