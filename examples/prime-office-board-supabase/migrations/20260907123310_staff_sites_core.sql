-- 拠点（スタッフ用の入り口）。本部は members 側でこれまでどおり、
-- 各拠点のスタッフは staff 側の名前＋暗証番号で入る。
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,24}$'),
  name text not null,
  sort_order integer not null default 0,
  -- 入り口の公開。false のあいだは既存スタッフもログインできない。
  open boolean not null default true,
  -- どのタブを見せるかを本部が決める。
  tabs jsonb not null default '{"att":true,"key":true,"todo":true,"shift":true}'::jsonb,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  -- 4桁の暗証番号を bcrypt で保存する。平文はどこにも残さない。
  pin_hash text,
  role text not null default 'staff' check (role in ('staff','manager')),
  key_holder boolean not null default false,
  key_note text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  -- 暗証番号の照合に成功したときだけ作られる Supabase 認証ユーザー。
  auth_user_id uuid unique references auth.users(id) on delete set null,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, name)
);
create index if not exists staff_site_idx on public.staff (site_id, active, sort_order);

create table if not exists public.punches (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  kind text not null check (kind in ('in','out')),
  punched_at timestamptz not null default now(),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists punches_site_at_idx on public.punches (site_id, punched_at desc);

-- 「開けた」「閉めた」の報告。誰がいつ、を残すだけの追記型。
create table if not exists public.key_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  kind text not null check (kind in ('open','close')),
  happened_at timestamptz not null default now(),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists key_events_site_at_idx on public.key_events (site_id, happened_at desc);

-- その日の鍵の開け閉め担当。
create table if not exists public.key_duty (
  site_id uuid not null references public.sites(id) on delete cascade,
  date date not null,
  open_staff uuid references public.staff(id) on delete set null,
  close_staff uuid references public.staff(id) on delete set null,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (site_id, date)
);

create table if not exists public.staff_todos (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  title text not null,
  detail text not null default '',
  assignee uuid references public.staff(id) on delete set null,
  due date,
  status text not null default 'open' check (status in ('open','done')),
  done_by uuid references public.staff(id) on delete set null,
  done_at timestamptz,
  -- 終わった人が残す共有メモ。次の人がこれを読む。
  done_memo text not null default '',
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists staff_todos_site_idx on public.staff_todos (site_id, status, due);

create table if not exists public.staff_shifts (
  site_id uuid not null references public.sites(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  date date not null,
  kind text not null default 'work' check (kind in ('work','off','undecided')),
  from_time text not null default '',
  to_time text not null default '',
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (staff_id, date)
);
create index if not exists staff_shifts_site_date_idx on public.staff_shifts (site_id, date);