-- 追加機能：ボードの見た目と呼び方を「設定」から変える・自由な一覧を足す。
--
-- 01 のあとに流す。PRIME の本番には流していない。画面側は board_settings に ui 列が
-- あるときだけカスタマイズの欄を出すので、流していないボードは今までどおり動く。

-- ---------------------------------------------------------------------------
-- 1. 見た目と呼び方。1行の JSON にまとめて持つ（ボード全体で1つ）。
--    {
--      "theme": "spring" | "summer" | "autumn" | "winter",
--      "tabs":  { "<タブID>": { "label": "...", "short": "...", "off": false } },
--      "kinds": { "<動きID>": { "label": "...", "off": false } },
--      "place": "事務所",                       -- 「〇〇 あいてます」の〇〇
--      "shopCats": [ { "id": "shop", "label": "店舗" }, ... ],
--      "home":  { "door": true, "present": true, "devices": true, "reminders": true, "notes": true }
--    }
--    書けるのは本部メンバーだけ（board_settings の既存ポリシーのまま）。
alter table public.board_settings add column if not exists ui jsonb not null default '{}'::jsonb;

-- ログイン前の画面にも色を出したいので、名前と一緒に季節だけを返す。
create or replace function public.board_brand()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('brand', s.brand, 'sub', s.brand_sub, 'theme', s.ui ->> 'theme')
       from public.board_settings s where s.id = 1),
    '{}'::jsonb)
$$;
revoke all on function public.board_brand() from public;
grant execute on function public.board_brand() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. 情報タブ（元は「店舗」）の分類を自由に増やせるようにする。
--    元は 'shop' と 'cast' の2つに固定されていた。分類の名前は ui.shopCats が持つ。
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.shops'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%kind%'
  loop
    execute format('alter table public.shops drop constraint %I', c);
  end loop;
end $$;
alter table public.shops add constraint shops_kind_format check (kind ~ '^[a-z0-9_-]{1,24}$');

-- ---------------------------------------------------------------------------
-- 3. 自由な一覧（買い物リスト・取引先など）。一覧の名前と、その中の項目。
create table if not exists public.lists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 30),
  sort_order integer not null default 0,
  created_by uuid default auth.uid() references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.list_items (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.lists(id) on delete cascade,
  title      text not null check (length(btrim(title)) between 1 and 200),
  memo       text not null default '',
  done       boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid default auth.uid() references public.members(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists list_items_list_idx on public.list_items (list_id, done, sort_order);

alter table public.lists enable row level security;
alter table public.list_items enable row level security;
create policy lists_all on public.lists for all
  using (is_member()) with check (is_member());
create policy list_items_all on public.list_items for all
  using (is_member()) with check (is_member());
alter publication supabase_realtime add table public.lists;
alter publication supabase_realtime add table public.list_items;
