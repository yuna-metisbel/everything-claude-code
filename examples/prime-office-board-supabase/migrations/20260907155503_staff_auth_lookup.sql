-- 認証ユーザーを作り直そうとしたときに、すでにある行を引き当てるためだけの補助。
-- ログイン処理（service_role）からしか呼べない。
create or replace function public.staff_auth_id_by_email(p_email text)
  returns uuid language sql security definer set search_path = public, auth as
$$ select id from auth.users where lower(email) = lower(p_email) limit 1 $$;
revoke all on function public.staff_auth_id_by_email(text) from public, anon, authenticated;