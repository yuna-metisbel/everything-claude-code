-- 本部の「タスク」と拠点の「TODO」は同じもの（誰かがやる仕事）だったので、
-- tasks 一本にまとめ、どこの仕事かを site_id で表す。null は本部。
alter table public.tasks add column if not exists site_id uuid references public.sites(id) on delete cascade;
-- 担当は本部メンバー（assignee）か拠点スタッフ（staff_assignee）のどちらか。
-- 認証の系統が別なので、1つの列にまとめず両方持つ。
alter table public.tasks add column if not exists staff_assignee uuid references public.staff(id) on delete set null;
alter table public.tasks add column if not exists staff_created_by uuid references public.staff(id) on delete set null;
alter table public.tasks add column if not exists staff_done_by uuid references public.staff(id) on delete set null;
-- 終わった人が次の人のために残すメモ。TODO 側にしかなかったので本部側にも広げる。
alter table public.tasks add column if not exists done_memo text not null default '';

create index if not exists tasks_site_idx on public.tasks (site_id, status, due);

-- staff_todos は0件のまま使われずに終わったので、移行するものはない。
drop table if exists public.staff_todos;

-- 本部は全部、スタッフは自分の拠点ぶんだけ。
drop policy if exists tasks_all on public.tasks;
create policy tasks_read on public.tasks for select
  using (public.is_member() or site_id = public.staff_site());
create policy tasks_write on public.tasks for all
  using (public.is_member() or site_id = public.staff_site())
  with check (public.is_member() or site_id = public.staff_site());