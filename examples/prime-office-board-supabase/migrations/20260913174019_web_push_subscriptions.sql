-- スマホへの通知の宛先。1人が複数の端末を持つので、端末ごとに1行。
-- endpoint がその端末の宛先そのものなので、これを主キー代わりの一意キーにする。
create table if not exists public.push_subs (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  label      text not null default '',
  failed_at  timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_member_idx on public.push_subs (member_id);

alter table public.push_subs enable row level security;

-- 自分の端末だけを足したり消したりできる。他人の宛先は読めない。
create policy push_subs_own on public.push_subs for all
  using (member_id = auth.uid()) with check (member_id = auth.uid());

-- 送信鍵。service_role だけが触れればよいので、誰にもポリシーを与えない。
-- （RLS 有効かつポリシー無し＝ anon / authenticated からは1行も見えない）
create table if not exists public.push_config (
  id          integer primary key default 1 check (id = 1),
  public_key  text not null default '',
  private_key text not null default '',
  updated_at  timestamptz not null default now()
);
alter table public.push_config enable row level security;
insert into public.push_config (id) values (1) on conflict (id) do nothing;

-- 送った通知の控え。同じものを二重に送らないための目印にも使う。
create table if not exists public.push_log (
  id         uuid primary key default gen_random_uuid(),
  tag        text not null unique,
  title      text not null default '',
  sent_at    timestamptz not null default now(),
  ok_count   integer not null default 0,
  fail_count integer not null default 0
);
alter table public.push_log enable row level security;
create policy push_log_read on public.push_log for select using (is_member());