-- 本部が4桁を確認できるようにするには、暗証番号を戻せる形で持つ必要がある。
-- 4桁は候補が1万通りしかなく bcrypt にしても総当たりは一瞬で終わるため、
-- ハッシュ化は「テーブルを読めた相手」に対しては実質的な守りになっていない。
-- 見せる要件と両立しない見かけだけの防御はやめ、平文1列にして、
-- 「誰が読めるか」を列の権限と関数で厳密に絞る方針に切り替える。
alter table public.staff add column if not exists pin text;
alter table public.staff drop column if exists pin_hash;

-- 表単位の権限は剥がしてあるので、新しい列には既定で誰の権限も付かない。
-- 念のため明示しておく（クライアントからは読み書きとも不可）。
revoke all (pin) on public.staff from anon, authenticated;

-- 新規登録の受付。本部が拠点ごとに開け閉めする。
alter table public.sites add column if not exists staff_signup boolean not null default true;

-- 本部だけが4桁を読める。店長にも他人の番号は見せない。
create or replace function public.staff_pin_of(p_staff uuid) returns text
  language sql stable security definer set search_path = public as
$$ select case when public.is_member() then s.pin end from public.staff s where s.id = p_staff $$;
revoke all on function public.staff_pin_of(uuid) from public, anon;
grant execute on function public.staff_pin_of(uuid) to authenticated;

-- 暗証番号の設定。本部・その拠点の店長・本人。
create or replace function public.staff_set_pin(p_staff uuid, p_pin text)
  returns void language plpgsql security definer set search_path = public as
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
  if not (public.is_member()
          or (v_site = public.staff_site() and public.staff_is_manager())
          or p_staff = public.staff_me()) then
    raise exception '権限がありません';
  end if;
  update public.staff set pin = p_pin, pin_set = true, updated_at = now() where id = p_staff;
  delete from public.staff_login_attempts where staff_id = p_staff;
end;
$$;
revoke all on function public.staff_set_pin(uuid, text) from public, anon;
grant execute on function public.staff_set_pin(uuid, text) to authenticated;

-- 照合。ログイン処理（service_role）からのみ。
create or replace function public.staff_check_pin(p_staff uuid, p_pin text)
  returns jsonb language plpgsql security definer set search_path = public as
$$
declare r record; a record; ok boolean;
begin
  select s.id, s.name, s.site_id, s.pin, s.active, s.auth_user_id, t.open
    into r from public.staff s join public.sites t on t.id = s.site_id where s.id = p_staff;
  if not found or not r.active or not r.open then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if r.pin is null then
    return jsonb_build_object('ok', false, 'reason', 'nopin');
  end if;

  select * into a from public.staff_login_attempts where staff_id = p_staff;
  if found and a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', a.locked_until);
  end if;

  ok := (r.pin = p_pin);
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

-- スタッフ本人による登録。入り口が公開中で、受付が開いている拠点だけ。
create or replace function public.staff_register(p_code text, p_name text, p_pin text)
  returns jsonb language plpgsql security definer set search_path = public as
$$
declare t record; nm text; v_id uuid; n int;
begin
  nm := btrim(p_name);
  if nm = '' or length(nm) > 30 then
    return jsonb_build_object('ok', false, 'error', '名前を入力してください（30文字まで）');
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', '暗証番号は数字4桁です');
  end if;
  select * into t from public.sites where code = lower(btrim(p_code)) and open;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'この入り口はいま使えません');
  end if;
  if not t.staff_signup then
    return jsonb_build_object('ok', false, 'error', 'いまは新規登録を受け付けていません。本部に連絡してください');
  end if;
  if exists (select 1 from public.staff s where s.site_id = t.id and lower(s.name) = lower(nm)) then
    return jsonb_build_object('ok', false, 'error', 'その名前はすでに登録されています。ログインするか、別の書き方にしてください');
  end if;
  -- URL を知っていれば誰でも登録できるので、いたずらで際限なく増えないよう上限を置く。
  select count(*) into n from public.staff where site_id = t.id;
  if n >= 40 then
    return jsonb_build_object('ok', false, 'error', '登録できる人数の上限です。本部に連絡してください');
  end if;
  insert into public.staff (site_id, name, pin, pin_set, sort_order)
    values (t.id, nm, p_pin, true,
            coalesce((select max(sort_order) from public.staff where site_id = t.id), 0) + 1)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'staffId', v_id);
end;
$$;
revoke all on function public.staff_register(text, text, text) from public;
grant execute on function public.staff_register(text, text, text) to anon, authenticated;

-- 入り口の照会に、受付中かどうかを足す。
create or replace function public.site_gate(p_code text)
  returns jsonb language sql stable security definer set search_path = public as
$$
  select coalesce(
    (select jsonb_build_object(
       'id', t.id, 'code', t.code, 'name', t.name, 'tabs', t.tabs, 'signup', t.staff_signup,
       'staff', coalesce((
         select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'hasPin', s.pin is not null)
                          order by s.sort_order, s.name)
         from public.staff s where s.site_id = t.id and s.active), '[]'::jsonb))
     from public.sites t where t.code = lower(trim(p_code)) and t.open),
    '{}'::jsonb)
$$;
grant execute on function public.site_gate(text) to anon, authenticated;