-- The owner opted for open sign-up: the board's URL is only shared with staff.
update public.board_settings set signup_mode = 'open', updated_at = now() where id = 1;

-- The sign-up form has to know which fields to show before anyone is signed in,
-- but board_settings holds the invite code and stays members-only. Expose the
-- mode alone through a function callable by a signed-out visitor.
create or replace function public.signup_mode()
returns text
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select s.signup_mode from public.board_settings s where s.id = 1), 'code') $$;

revoke all on function public.signup_mode() from public;
grant execute on function public.signup_mode() to anon, authenticated;
