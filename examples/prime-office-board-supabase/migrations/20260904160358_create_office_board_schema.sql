-- PRIME 事務所ボード: staff-shared schedule / tasks / payments / office state / media accounts

create table if not exists public.members (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  color       text not null default '#9C6C1F',
  present     boolean not null default false,
  present_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.allowed_emails (
  email      text primary key,
  note       text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.office (
  id         int primary key default 1 check (id = 1),
  door_open  boolean not null default false,
  updated_by uuid references public.members(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.schedule (
  member_id  uuid not null references public.members(id) on delete cascade,
  date       date not null,
  kind       text not null default '' check (kind in ('', 'work', 'off', 'half')),
  plan       text not null default '',
  ng_from    text not null default '',
  ng_to      text not null default '',
  note       text not null default '',
  updated_by uuid references public.members(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (member_id, date)
);

create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  detail     text not null default '',
  assignee   uuid references public.members(id) on delete set null,
  status     text not null default 'open' check (status in ('open', 'doing', 'done')),
  due        date,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  taken_at   timestamptz,
  done_at    timestamptz,
  done_by    uuid references public.members(id) on delete set null
);

create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  payee      text not null default '',
  amount     numeric not null default 0,
  due        date,
  method     text not null default '',
  assignee   uuid references public.members(id) on delete set null,
  status     text not null default 'unpaid' check (status in ('unpaid', 'paid')),
  note       text not null default '',
  paid_at    timestamptz,
  paid_by    uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- login id / password are stored ONLY as AES-GCM ciphertext produced in the browser
create table if not exists public.vault (
  id         uuid primary key default gen_random_uuid(),
  media      text not null,
  url        text not null default '',
  note       text not null default '',
  enc        jsonb,
  updated_by uuid references public.members(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_config (
  id         int primary key default 1 check (id = 1),
  salt       text not null,
  verify     jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists schedule_date_idx on public.schedule (date);
create index if not exists tasks_status_idx  on public.tasks (status);
create index if not exists payments_status_idx on public.payments (status);
