-- 暗証番号のハッシュは誰にも読ませない。4桁は総当たりが一瞬なので、
-- 行が読めてもハッシュだけは出ない列単位の権限にする。
revoke all (pin_hash) on public.staff from anon, authenticated;
-- 認証ユーザーの紐付けはログイン処理（service_role）だけが書く。
revoke insert (auth_user_id), update (auth_user_id) on public.staff from anon, authenticated;
revoke insert (last_login_at), update (last_login_at) on public.staff from anon, authenticated;

-- 総当たり対策。ログイン処理だけが読み書きする。
create table if not exists public.staff_login_attempts (
  staff_id uuid primary key references public.staff(id) on delete cascade,
  fails integer not null default 0,
  locked_until timestamptz,
  last_try_at timestamptz not null default now()
);
alter table public.staff_login_attempts enable row level security;

-- 暗証番号の設定。本部と、その拠点の店長だけ。平文は保存しない。
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
  update public.staff set pin_hash = crypt(p_pin, gen_salt('bf', 10)), updated_at = now()
   where id = p_staff;
  delete from public.staff_login_attempts where staff_id = p_staff;
end;
$$;
revoke all on function public.staff_set_pin(uuid, text) from public, anon;
grant execute on function public.staff_set_pin(uuid, text) to authenticated;

-- 入り口の表示に必要な最小限だけを返す。合言葉の代わりに入り口コードが鍵なので、
-- コードが一致し、かつ公開中の拠点しか答えない。
create or replace function public.site_gate(p_code text)
  returns jsonb language sql stable security definer set search_path = public as
$$
  select coalesce(
    (select jsonb_build_object(
       'id', t.id, 'code', t.code, 'name', t.name, 'tabs', t.tabs,
       'staff', coalesce((
         select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'hasPin', s.pin_hash is not null)
                          order by s.sort_order, s.name)
         from public.staff s where s.site_id = t.id and s.active), '[]'::jsonb))
     from public.sites t where t.code = lower(trim(p_code)) and t.open),
    '{}'::jsonb)
$$;
grant execute on function public.site_gate(text) to anon, authenticated;

-- 暗証番号の照合。ログイン処理（service_role）からのみ呼ぶ。
create or replace function public.staff_check_pin(p_staff uuid, p_pin text)
  returns jsonb language plpgsql security definer set search_path = public, extensions as
$$
declare r record; a record; ok boolean;
begin
  select s.id, s.name, s.site_id, s.pin_hash, s.active, s.auth_user_id, t.open
    into r from public.staff s join public.sites t on t.id = s.site_id where s.id = p_staff;
  if not found or not r.active or not r.open then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if r.pin_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'nopin');
  end if;

  select * into a from public.staff_login_attempts where staff_id = p_staff;
  if found and a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', a.locked_until);
  end if;

  ok := (crypt(p_pin, r.pin_hash) = r.pin_hash);
  if ok then
    delete from public.staff_login_attempts where staff_id = p_staff;
    return jsonb_build_object('ok', true, 'siteId', r.site_id, 'name', r.name, 'authUserId', r.auth_user_id);
  end if;

  insert into public.staff_login_attempts (staff_id, fails, last_try_at)
    values (p_staff, 1, now())
    on conflict (staff_id) do update
      set fails = public.staff_login_attempts.fails + 1,
          last_try_at = now(),
          locked_until = case when public.staff_login_attempts.fails + 1 >= 5
                              then now() + interval '10 minutes' else null end;
  return jsonb_build_object('ok', false, 'reason', 'bad');
end;
$$;
revoke all on function public.staff_check_pin(uuid, text) from public, anon, authenticated;

-- ログイン成功時の記録。ログイン処理からのみ。
create or replace function public.staff_mark_login(p_staff uuid, p_auth uuid)
  returns void language sql security definer set search_path = public as
$$ update public.staff set auth_user_id = p_auth, last_login_at = now() where id = p_staff $$;
revoke all on function public.staff_mark_login(uuid, uuid) from public, anon, authenticated;