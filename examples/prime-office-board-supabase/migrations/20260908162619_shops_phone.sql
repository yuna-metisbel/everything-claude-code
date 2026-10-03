-- 店舗にかける電話番号。■ の貼り付けブロックとは別に持つ。
-- ブロックに混ぜると、コピーして貼り直したときに見出しとして二重に増えるため。
alter table public.shops add column if not exists phone text not null default '';