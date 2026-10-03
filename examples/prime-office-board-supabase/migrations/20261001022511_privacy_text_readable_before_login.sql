-- 個人情報の取り扱い。スタッフが登録する前に読めないと意味がないので、
-- 本文だけを anon にも開ける。board_settings 自体は本部のみのまま
-- （招待コードが同じ行にあるので、行ごと開けてはいけない）。
alter table public.board_settings add column if not exists privacy_text text not null default '';

create or replace function public.privacy_text()
returns text
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select s.privacy_text from public.board_settings s where s.id = 1), '') $$;

revoke all on function public.privacy_text() from public;
grant execute on function public.privacy_text() to anon, authenticated;
