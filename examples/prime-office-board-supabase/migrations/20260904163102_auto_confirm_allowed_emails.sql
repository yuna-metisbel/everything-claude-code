-- Staff sign up with an address the board's owner has already allow-listed, so a
-- confirmation email adds nothing but a delay (and the built-in mailer is rate
-- limited on the free tier). Confirm those addresses on insert; leave everyone
-- else unconfirmed so a stranger who finds the URL cannot sign in at all.
create or replace function public.auto_confirm_allowed()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email_confirmed_at is null
     and (
       not exists (select 1 from public.members)
       or exists (
         select 1 from public.allowed_emails a
         where lower(a.email) = lower(new.email)
       )
     )
  then
    new.email_confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists auto_confirm_allowed_trg on auth.users;
create trigger auto_confirm_allowed_trg
  before insert on auth.users
  for each row execute function public.auto_confirm_allowed();
