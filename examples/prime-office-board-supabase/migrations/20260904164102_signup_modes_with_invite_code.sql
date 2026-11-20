-- The board's owner does not have the staff's email addresses, so gating sign-up
-- on an allow-list of addresses does not work in practice. Add a shared invite
-- code as the default gate, keep the allow-list as an option, and allow fully
-- open sign-up when the owner deliberately chooses it.

create table if not exists public.board_settings (
  id          int primary key default 1 check (id = 1),
  signup_mode text not null default 'code' check (signup_mode in ('code', 'allowlist', 'open')),
  invite_code text not null default '',
  updated_at  timestamptz not null default now()
);

insert into public.board_settings (id, signup_mode, invite_code)
values (1, 'code', 'PRIME-' || lpad((floor(random() * 10000))::int::text, 4, '0'))
on conflict (id) do nothing;

alter table public.board_settings enable row level security;

drop policy if exists board_settings_all on public.board_settings;
create policy board_settings_all on public.board_settings
  for all to authenticated using (public.is_member()) with check (public.is_member());

-- Sign-up gate. The invite code is compared server-side against the stored one;
-- a user can put anything in their own metadata, but they still have to know the
-- code. The bootstrap case (no members yet) stays open so the board can be set up.
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
      select 1 from public.board_settings s
      where s.id = 1
        and (
          s.signup_mode = 'open'
          or (
            s.signup_mode = 'code'
            and s.invite_code <> ''
            and coalesce(auth.jwt() -> 'user_metadata' ->> 'invite_code', '') = s.invite_code
          )
        )
    )
    or exists (
      select 1 from public.allowed_emails a
      where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
$$;

-- Same rule, applied to the confirmation flag, so a permitted sign-up can log in
-- straight away and anyone else stays unconfirmed and locked out.
create or replace function public.auto_confirm_allowed()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  mode text;
  code text;
begin
  if new.email_confirmed_at is not null then
    return new;
  end if;

  select s.signup_mode, s.invite_code into mode, code
  from public.board_settings s where s.id = 1;

  if not exists (select 1 from public.members)
     or mode = 'open'
     or (mode = 'code' and coalesce(code, '') <> ''
         and coalesce(new.raw_user_meta_data ->> 'invite_code', '') = code)
     or exists (
       select 1 from public.allowed_emails a
       where lower(a.email) = lower(new.email)
     )
  then
    new.email_confirmed_at := now();
  end if;

  return new;
end;
$$;
