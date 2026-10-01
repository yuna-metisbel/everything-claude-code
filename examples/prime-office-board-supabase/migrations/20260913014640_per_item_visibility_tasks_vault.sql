-- やることと ID/パスに、1件ごとの公開範囲を付ける。
--   open_sites  … この拠点のスタッフにも見せる（空なら本部だけ）
--   share/shared_with … 本部の中で誰に見せるか（all なら本部全員）
-- 既存の行は share='all' / 配列は空なので、これまでと同じ見え方のまま。
alter table public.tasks add column if not exists share text not null default 'all'
  check (share in ('all', 'some'));
alter table public.tasks add column if not exists shared_with uuid[] not null default '{}';
alter table public.tasks add column if not exists open_sites uuid[] not null default '{}';

alter table public.vault add column if not exists share text not null default 'all'
  check (share in ('all', 'some'));
alter table public.vault add column if not exists shared_with uuid[] not null default '{}';
alter table public.vault add column if not exists open_sites uuid[] not null default '{}';

-- 本部メンバーから見えるか。作った人と担当は、範囲から外れていても自分の仕事を見失わない。
create or replace function public.hq_can_see(p_share text, p_shared uuid[], p_owners uuid[])
returns boolean
language sql stable
set search_path to 'public'
as $$
  select is_member() and (
    p_share = 'all'
    or auth.uid() = any (p_shared)
    or auth.uid() = any (p_owners)
  )
$$;

drop policy if exists tasks_read on public.tasks;
drop policy if exists tasks_write on public.tasks;
create policy tasks_read on public.tasks for select
  using (
    hq_can_see(share, shared_with, array[created_by, assignee, done_by])
    or site_id = staff_site()
    or staff_site() = any (open_sites)
  );
create policy tasks_write on public.tasks for all
  using (
    hq_can_see(share, shared_with, array[created_by, assignee, done_by])
    or site_id = staff_site()
    or staff_site() = any (open_sites)
  )
  with check (
    hq_can_see(share, shared_with, array[created_by, assignee, done_by])
    or site_id = staff_site()
    or staff_site() = any (open_sites)
  );

drop policy if exists vault_all on public.vault;
-- 拠点に開けた行は、その拠点のスタッフは読むだけ。書き換えは本部だけ。
create policy vault_read on public.vault for select
  using (
    hq_can_see(share, shared_with, array[updated_by])
    or staff_site() = any (open_sites)
  );
create policy vault_write on public.vault for all
  using (hq_can_see(share, shared_with, array[updated_by]))
  with check (hq_can_see(share, shared_with, array[updated_by]));