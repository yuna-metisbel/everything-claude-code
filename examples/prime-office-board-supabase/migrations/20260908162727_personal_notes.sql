-- 本部メンバーの、自分だけの持ち物（メモとやること）。
-- tasks はチーム全員が読める前提で作ってあるので、そこに私物を混ぜると
-- 読み取りポリシーを一箇所間違えただけで全部見えてしまう。表を分けて、
-- 「自分のもの」と「見せると決めたもの」だけが読める規則にする。
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references public.members(id) on delete cascade,
  kind        text not null default 'task' check (kind in ('task', 'memo')),
  title       text not null,
  body        text not null default '',
  status      text not null default 'open' check (status in ('open', 'done')),
  due         date,
  -- private = 自分だけ / some = 選んだ人 / all = 本部の全員
  share       text not null default 'private' check (share in ('private', 'some', 'all')),
  shared_with uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists notes_owner_idx on public.notes (owner, created_at desc);

alter table public.notes enable row level security;

-- 読めるのは、自分のものか、本人が見せると決めたものだけ。
-- 拠点スタッフは is_member() を満たさないので、共有されていても届かない。
create policy notes_select on public.notes for select
  using (
    owner = auth.uid()
    or (is_member() and (share = 'all' or auth.uid() = any (shared_with)))
  );

-- 作れるのは自分名義のものだけ。他人名義で作って読ませることはできない。
create policy notes_insert on public.notes for insert
  with check (owner = auth.uid() and is_member());

-- 直せる・消せるのは持ち主だけ。共有された側は読むだけ。
create policy notes_update on public.notes for update
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy notes_delete on public.notes for delete
  using (owner = auth.uid());