-- Everyone here is an independent contractor, so 出勤/公休/半休 was the wrong
-- vocabulary. What the team needs to see is where a person is working from and,
-- when they come to the office, between what hours.
alter table public.schedule add column if not exists from_time text not null default '';
alter table public.schedule add column if not exists to_time   text not null default '';
alter table public.schedule add column if not exists link_url  text not null default '';

alter table public.schedule drop constraint if exists schedule_kind_check;
update public.schedule set kind = 'office' where kind in ('work', 'half');
alter table public.schedule
  add constraint schedule_kind_check check (kind in ('', 'off', 'office', 'home', 'out'));

-- Shared entries: a whole-team meeting, a call with a media rep, or a plain
-- announcement such as a new staff member joining. `date` is null for notices
-- that are not tied to a day.
create table if not exists public.notices (
  id         uuid primary key default gen_random_uuid(),
  date       date,
  title      text not null,
  body       text not null default '',
  url        text not null default '',
  pinned     boolean not null default false,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notices enable row level security;
drop policy if exists notices_all on public.notices;
create policy notices_all on public.notices
  for all to authenticated using (public.is_member()) with check (public.is_member());
alter publication supabase_realtime add table public.notices;
create index if not exists notices_date_idx on public.notices (date desc nulls last, created_at desc);

-- The recruitment pipeline the office is building; interview entries link to it.
alter table public.board_settings add column if not exists recruit_url text not null default '';
