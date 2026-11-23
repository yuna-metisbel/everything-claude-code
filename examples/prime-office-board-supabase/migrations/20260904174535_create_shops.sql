-- Per-shop recruitment details. Staff read these out when answering applicants,
-- so the fields mirror the format the office already writes them in and each
-- one is free text rather than a parsed number.
create table if not exists public.shops (
  id          uuid primary key default gen_random_uuid(),
  sort_order  int not null default 0,
  name        text not null,
  url         text not null default '',
  hours       text not null default '',   -- 営業時間
  station     text not null default '',   -- 最寄り駅
  pickup      text not null default '',   -- 送り迎え
  hiring      text not null default '',   -- 採用基準
  pay         text not null default '',   -- 女子給
  nomination  text not null default '',   -- 指名料
  misc        text not null default '',   -- 雑費
  standby     text not null default '',   -- 待機
  id_docs     text not null default '',   -- 必要な身分証の種類
  training    text not null default '',   -- 講習の有無
  pr          text not null default '',   -- PR
  note        text not null default '',   -- その他メモ
  updated_by  uuid references public.members(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.shops enable row level security;

drop policy if exists shops_all on public.shops;
create policy shops_all on public.shops
  for all to authenticated using (public.is_member()) with check (public.is_member());

alter publication supabase_realtime add table public.shops;

create index if not exists shops_sort_idx on public.shops (sort_order, name);
