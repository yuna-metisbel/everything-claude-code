-- Access gate: a signed-in user sees nothing until they have a members row.
-- A members row can only be created for an allow-listed email (or by the very first user,
-- who bootstraps the board).

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.members m where m.id = auth.uid()) $$;

create or replace function public.may_join()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not exists (select 1 from public.members)
    or exists (
      select 1 from public.allowed_emails a
      where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
$$;

alter table public.members        enable row level security;
alter table public.allowed_emails enable row level security;
alter table public.office         enable row level security;
alter table public.schedule       enable row level security;
alter table public.tasks          enable row level security;
alter table public.payments       enable row level security;
alter table public.vault          enable row level security;
alter table public.vault_config   enable row level security;

-- members
create policy members_select on public.members
  for select to authenticated using (public.is_member() or id = auth.uid());
create policy members_insert on public.members
  for insert to authenticated with check (id = auth.uid() and public.may_join());
create policy members_update on public.members
  for update to authenticated using (public.is_member()) with check (public.is_member());
create policy members_delete on public.members
  for delete to authenticated using (public.is_member());

-- allowed_emails: members manage the roster
create policy allowed_all on public.allowed_emails
  for all to authenticated using (public.is_member()) with check (public.is_member());

-- shared board data: members only
create policy office_all on public.office
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy schedule_all on public.schedule
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy tasks_all on public.tasks
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy payments_all on public.payments
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy vault_all on public.vault
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy vault_config_all on public.vault_config
  for all to authenticated using (public.is_member()) with check (public.is_member());

-- live updates for every open tab
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.office;
alter publication supabase_realtime add table public.schedule;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.payments;
alter publication supabase_realtime add table public.vault;
alter publication supabase_realtime add table public.vault_config;

insert into public.office (id, door_open) values (1, false) on conflict (id) do nothing;
