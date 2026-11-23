-- 鍵を誰が持っているかは、その拠点で働いている人がいちばん分かっている。
-- ただし staff 表には暗証番号も役割もあるので、表ごと書けるようにはしない。
-- 鍵の2列だけを書き換える関数を通す。
create or replace function public.set_key_holder(p_staff uuid, p_on boolean, p_note text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  target_site uuid;
begin
  select site_id into target_site from public.staff where id = p_staff;
  if target_site is null then
    return false;
  end if;
  -- 本部は全拠点、スタッフは自分の拠点の人だけ。
  if not (public.is_member() or target_site = public.staff_site()) then
    return false;
  end if;
  update public.staff
     set key_holder = coalesce(p_on, false),
         key_note   = coalesce(left(p_note, 60), ''),
         updated_at = now()
   where id = p_staff;
  return true;
end $$;

revoke all on function public.set_key_holder(uuid, boolean, text) from public;
revoke all on function public.set_key_holder(uuid, boolean, text) from anon;
grant execute on function public.set_key_holder(uuid, boolean, text) to authenticated;