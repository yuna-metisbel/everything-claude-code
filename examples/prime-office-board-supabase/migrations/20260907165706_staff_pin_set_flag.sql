-- ハッシュは読めないので、「暗証番号を発行済みか」だけを別の列で見せる。
alter table public.staff add column if not exists pin_set boolean not null default false;
update public.staff set pin_set = (pin_hash is not null);
revoke insert (pin_set), update (pin_set) on public.staff from anon, authenticated;

create or replace function public.staff_set_pin(p_staff uuid, p_pin text)
  returns void language plpgsql security definer set search_path = public, extensions as
$$
declare v_site uuid;
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception '暗証番号は数字4桁で入力してください';
  end if;
  select site_id into v_site from public.staff where id = p_staff;
  if v_site is null then
    raise exception 'スタッフが見つかりません';
  end if;
  if not (public.is_member() or (v_site = public.staff_site() and public.staff_is_manager())) then
    raise exception '権限がありません';
  end if;
  update public.staff
     set pin_hash = crypt(p_pin, gen_salt('bf', 10)), pin_set = true, updated_at = now()
   where id = p_staff;
  delete from public.staff_login_attempts where staff_id = p_staff;
end;
$$;
revoke all on function public.staff_set_pin(uuid, text) from public, anon;
grant execute on function public.staff_set_pin(uuid, text) to authenticated;