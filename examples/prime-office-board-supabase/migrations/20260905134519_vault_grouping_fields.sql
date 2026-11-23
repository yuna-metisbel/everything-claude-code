-- The ID/pass list is expected to grow, and entries belong to different things:
-- a site, a cast member, or a shop. Store those alongside the credential so the
-- list can be grouped and filtered by each.
alter table public.vault add column if not exists shop text not null default '';
alter table public.vault add column if not exists cast_name text not null default '';

create index if not exists vault_shop_idx on public.vault (shop);
create index if not exists vault_cast_idx on public.vault (cast_name);
create index if not exists vault_media_idx on public.vault (media);
