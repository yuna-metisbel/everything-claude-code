-- Supabase は public の全テーブルに anon / authenticated への表単位の権限を配る。
-- 表単位の権限を持っている間は列単位の revoke が効かないので、いったん剥がしてから
-- 見せてよい列だけを grant し直す。pin_hash はここに含めない。
revoke select, insert, update on public.staff from anon, authenticated;

grant select (id, site_id, name, role, key_holder, key_note, active, sort_order,
              pin_set, last_login_at, auth_user_id, created_at, updated_at)
  on public.staff to anon, authenticated;

-- 名簿の編集で書き換えてよい列だけ。pin_hash / pin_set / auth_user_id / last_login_at は
-- ログイン処理と staff_set_pin（どちらも security definer）だけが書く。
grant insert (site_id, name, role, key_holder, key_note, active, sort_order)
  on public.staff to authenticated;
grant update (site_id, name, role, key_holder, key_note, active, sort_order)
  on public.staff to authenticated;