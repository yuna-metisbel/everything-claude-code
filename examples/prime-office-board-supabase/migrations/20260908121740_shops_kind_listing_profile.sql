-- 掲載用のプロフィールは、店舗の求人票と入れ物としては同じ（■ の見出しと値を順番どおり
-- 持って、そのままコピーして貼る）。テーブルを分けずに kind で仕分ける。
alter table public.shops add column if not exists kind text not null default 'shop'
  check (kind in ('shop', 'cast'));
create index if not exists shops_kind_idx on public.shops (kind, sort_order);