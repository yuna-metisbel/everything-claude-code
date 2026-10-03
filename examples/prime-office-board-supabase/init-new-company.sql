-- 新しい会社ぶんの初期設定。
--
-- migrations/ を全部流したあと、画面をその会社に渡す前に 1 回だけ実行する。
-- 流す順番の意味：
--   マイグレーションの 5 本目で、登録方法が「誰でも登録できる」になる。これは
--   PRIME が自分で選んだ設定で（URL を知る人が限られているという判断）、
--   渡し先の会社はその判断をしていない。そのまま公開すると、URL を知った人が
--   誰でも登録して、支払い・媒体の ID とパス・スタッフの暗証番号まで読める。
--   だからここで「招待コードが要る」に戻し、コードを作る。
--
-- まだ誰も登録していないボードでしか動かない。すでに使われているボードに
-- 間違って流したときは、何も変えずに止まる。

do $$
declare
  n_members integer;
  new_code  text;
begin
  select count(*) into n_members from public.members;

  if n_members > 0 then
    raise exception
      'このボードはもう使われています（members が % 行）。初期設定は流せません。'
      '別の会社のプロジェクトを開いていないか、URL を確かめてください。', n_members;
  end if;

  -- 読み上げても聞き間違えない字だけを使う（0/O、1/I/l を外す）。
  new_code := (
    select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
                             1 + (get_byte(b, i) % 32), 1), '')
      from (select gen_random_bytes(8) as b) g,
           generate_series(0, 7) as i
  );

  update public.board_settings
     set signup_mode = 'code',
         invite_code = new_code,
         updated_at  = now()
   where id = 1;

  raise notice '招待コード: %', new_code;
end $$;

-- 渡す前の確認。すべて ok になっていること。
select
  (select signup_mode from public.board_settings where id = 1)              as "登録方法",
  (select invite_code from public.board_settings where id = 1)              as "招待コード",
  (select count(*) from public.members)                                     as "登録済みの人",
  case when coalesce((select function_url from public.push_config where id = 1), '') <> ''
        and coalesce((select anon_key     from public.push_config where id = 1), '') <> ''
        and coalesce((select send_secret  from public.push_config where id = 1), '') <> ''
       then 'ok' else '未設定（手順4へ）' end                                as "通知の宛先",
  (select count(*) from information_schema.tables where table_schema = 'public') as "テーブル（23）",
  (select count(*) from pg_policies where schemaname = 'public')                 as "ポリシー（38）";
