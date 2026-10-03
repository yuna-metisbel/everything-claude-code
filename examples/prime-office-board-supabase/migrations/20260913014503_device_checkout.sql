-- 事務所から持ち出すもの（黒スマホなど）。鍵と同じで、
-- 「いま誰が持っているか」は最後の記録から決まるので、状態は列に持たず記録だけ残す。
-- あとから「あの日誰が持っていたか」を辿れるのも、記録で持つ理由。
create table if not exists public.devices (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  note       text not null default '',
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.device_log (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.devices(id) on delete cascade,
  kind        text not null check (kind in ('out', 'in')),
  member_id   uuid references public.members(id) on delete set null,
  happened_at timestamptz not null default now(),
  note        text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists device_log_recent_idx on public.device_log (device_id, happened_at desc);

alter table public.devices enable row level security;
alter table public.device_log enable row level security;

-- 事務所のものなので、本部のメンバーだけ。拠点のスタッフには見えない。
create policy devices_all on public.devices for all
  using (is_member()) with check (is_member());
create policy device_log_all on public.device_log for all
  using (is_member()) with check (is_member());

alter publication supabase_realtime add table public.devices;
alter publication supabase_realtime add table public.device_log;

insert into public.devices (name, sort_order)
select '黒スマホ', 1
where not exists (select 1 from public.devices where name = '黒スマホ');