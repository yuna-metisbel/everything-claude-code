-- 会議：お知らせと同じ「全員が見るもの」なので表は分けず、
-- 会議かどうかと、決まったことを足すだけにする。
-- 決まったことを議題と別の列にするのは、あとから読む人が探すのは決定のほうだから。
alter table public.notices add column if not exists kind text not null default 'notice'
  check (kind in ('notice', 'meeting'));
alter table public.notices add column if not exists at_time text not null default '';
alter table public.notices add column if not exists place text not null default '';
alter table public.notices add column if not exists decided text not null default '';
create index if not exists notices_kind_idx on public.notices (kind, date desc);

-- 緊急連絡先。members は本部メンバーだけが読める表なので、ここに置く。
-- 拠点スタッフからは見えない。
alter table public.members add column if not exists phone text not null default '';
alter table public.members add column if not exists emergency text not null default '';