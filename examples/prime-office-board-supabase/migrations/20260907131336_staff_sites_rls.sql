-- 現在のログインがどのスタッフか。本部メンバーなら null。
create or replace function public.staff_me() returns uuid
  language sql stable security definer set search_path = public as
$$ select s.id from public.staff s
   join public.sites t on t.id = s.site_id
   where s.auth_user_id = auth.uid() and s.active and t.open limit 1 $$;

create or replace function public.staff_site() returns uuid
  language sql stable security definer set search_path = public as
$$ select s.site_id from public.staff s
   join public.sites t on t.id = s.site_id
   where s.auth_user_id = auth.uid() and s.active and t.open limit 1 $$;

create or replace function public.staff_is_manager() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.staff s
     join public.sites t on t.id = s.site_id
     where s.auth_user_id = auth.uid() and s.active and t.open and s.role = 'manager') $$;

-- スタッフのログインで作られる認証ユーザーが本部メンバーに昇格できないようにする。
create or replace function public.may_join() returns boolean
  language sql stable security definer set search_path = public as
$$
  select not exists (select 1 from public.staff s where s.auth_user_id = auth.uid())
  and (
    not exists (select 1 from public.members)
    or exists (
      select 1 from public.board_settings s
      where s.id = 1
        and (
          s.signup_mode = 'open'
          or (s.signup_mode = 'code' and s.invite_code <> ''
              and coalesce(auth.jwt() -> 'user_metadata' ->> 'invite_code', '') = s.invite_code)
        )
    )
    or exists (
      select 1 from public.allowed_emails a
      where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
$$;

alter table public.sites        enable row level security;
alter table public.staff        enable row level security;
alter table public.punches      enable row level security;
alter table public.key_events   enable row level security;
alter table public.key_duty     enable row level security;
alter table public.staff_todos  enable row level security;
alter table public.staff_shifts enable row level security;

-- 本部は全拠点、スタッフは自分の拠点だけ。
create policy sites_read on public.sites for select
  using (public.is_member() or id = public.staff_site());
create policy sites_write on public.sites for all
  using (public.is_member()) with check (public.is_member());

create policy staff_read on public.staff for select
  using (public.is_member() or site_id = public.staff_site());
-- 名簿の編集は本部と、その拠点の店長だけ。
create policy staff_write on public.staff for all
  using (public.is_member() or (site_id = public.staff_site() and public.staff_is_manager()))
  with check (public.is_member() or (site_id = public.staff_site() and public.staff_is_manager()));

create policy punches_read on public.punches for select
  using (public.is_member() or site_id = public.staff_site());
-- 自分の打刻は自分で。他人ぶんの追加・修正は本部と店長だけ（打刻忘れの手直し用）。
create policy punches_insert on public.punches for insert
  with check (
    (site_id = public.staff_site() and staff_id = public.staff_me())
    or public.is_member()
    or (site_id = public.staff_site() and public.staff_is_manager()));
create policy punches_fix on public.punches for update
  using (public.is_member() or (site_id = public.staff_site() and public.staff_is_manager()))
  with check (public.is_member() or (site_id = public.staff_site() and public.staff_is_manager()));
create policy punches_del on public.punches for delete
  using (public.is_member() or (site_id = public.staff_site() and public.staff_is_manager()));

create policy key_events_read on public.key_events for select
  using (public.is_member() or site_id = public.staff_site());
create policy key_events_insert on public.key_events for insert
  with check (public.is_member() or site_id = public.staff_site());
create policy key_events_del on public.key_events for delete
  using (public.is_member() or (site_id = public.staff_site() and public.staff_is_manager()));

create policy key_duty_read on public.key_duty for select
  using (public.is_member() or site_id = public.staff_site());
create policy key_duty_write on public.key_duty for all
  using (public.is_member() or site_id = public.staff_site())
  with check (public.is_member() or site_id = public.staff_site());

create policy staff_todos_read on public.staff_todos for select
  using (public.is_member() or site_id = public.staff_site());
create policy staff_todos_write on public.staff_todos for all
  using (public.is_member() or site_id = public.staff_site())
  with check (public.is_member() or site_id = public.staff_site());

create policy staff_shifts_read on public.staff_shifts for select
  using (public.is_member() or site_id = public.staff_site());
-- 自分のシフトは自分で登録。他人ぶんは本部と店長。
create policy staff_shifts_write on public.staff_shifts for all
  using (public.is_member()
    or (site_id = public.staff_site() and (staff_id = public.staff_me() or public.staff_is_manager())))
  with check (public.is_member()
    or (site_id = public.staff_site() and (staff_id = public.staff_me() or public.staff_is_manager())));