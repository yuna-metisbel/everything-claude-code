-- 通知を1本送る。service_role の鍵を SQL に置かずに済むよう、合言葉で名乗る。
-- この時点の実物は送り先の URL と publishable キーを直書きしていた。
-- 他社に渡すファイルに弊社の接続先を残すのを避けるため、その2つだけを空にしてある
-- （本番と差分があるのは34本中この1本だけ）。
-- この関数は 20260930210858_push_send_portable_endpoint.sql で丸こと差し替わるので、
-- 上から順に全部適用すれば最終的な中身は本番と同じになる。
create or replace function public.push_send(p_title text, p_text text, p_url text, p_tag text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $$
declare
  secret text;
begin
  select send_secret into secret from public.push_config where id = 1;
  if coalesce(secret, '') = '' then return; end if;
  perform net.http_post(
    url := '',  -- 本番では Edge Function の URL。経緯はこのファイル冒頭のコメント。
    body := jsonb_build_object('action', 'send', 'title', p_title,
                               'text', p_text, 'url', p_url, 'tag', p_tag),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ',  -- 本番では publishable キー。同上。
      'x-push-secret', secret)
  );
end $$;
revoke all on function public.push_send(text, text, text, text) from public, anon, authenticated;

-- 書かれたらすぐ知らせる。会議かどうかで見出しを変える。
create or replace function public.notices_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  head text;
  when_txt text;
begin
  when_txt := coalesce(to_char(new.date, 'MM/DD'), '') ||
              case when coalesce(new.at_time, '') <> '' then ' ' || new.at_time else '' end;
  if tg_op = 'INSERT' then
    head := case when new.kind = 'meeting' then '会議が入りました' else 'お知らせ' end;
    perform public.push_send(head,
      trim(when_txt || ' ' || new.title), '/', 'notice-new-' || new.id::text);
    return new;
  end if;
  -- 決まったことは、会議に出られなかった人がいちばん知りたいところ。
  -- 空から中身が入ったときだけ鳴らす（手直しのたびに鳴らさない）。
  if coalesce(old.decided, '') = '' and coalesce(new.decided, '') <> '' then
    perform public.push_send('決まったこと：' || new.title,
      left(new.decided, 120), '/', 'notice-decided-' || new.id::text);
  end if;
  return new;
end $$;

drop trigger if exists notices_push_ins on public.notices;
drop trigger if exists notices_push_upd on public.notices;
create trigger notices_push_ins after insert on public.notices
  for each row execute function public.notices_push();
create trigger notices_push_upd after update on public.notices
  for each row execute function public.notices_push();

-- 朝のまとめ。今日と明日の会議、今日が期日のやること・支払いを1通にする。
-- 1件ずつ鳴らすと、多い日に通知が埋まって読まれなくなる。
create or replace function public.push_morning()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  jst_today date := ((now() at time zone 'Asia/Tokyo')::date);
  lines text[] := '{}';
  n_meet integer; n_task integer; n_pay integer;
  body text;
begin
  select count(*), string_agg(coalesce(nullif(at_time, '') || ' ', '') || title, '／')
    into n_meet, body
    from public.notices
   where kind = 'meeting' and date in (jst_today, jst_today + 1);
  if n_meet > 0 then lines := lines || ('会議：' || body); end if;

  select count(*), string_agg(title, '／') into n_task, body
    from public.tasks where status <> 'done' and due = jst_today;
  if n_task > 0 then lines := lines || ('今日が期日：' || body); end if;

  select count(*), string_agg(title, '／') into n_pay, body
    from public.payments where status <> 'paid' and due = jst_today;
  if n_pay > 0 then lines := lines || ('今日が支払期日：' || body); end if;

  -- 何も無い日は鳴らさない。空の通知は、次から見なくなる原因になる。
  if array_length(lines, 1) is null then return; end if;

  perform public.push_send(
    to_char(jst_today, 'MM/DD') || ' 今日のこと',
    left(array_to_string(lines, E'\n'), 300), '/', 'morning-' || jst_today::text);
end $$;
revoke all on function public.push_morning() from public, anon, authenticated;

-- 毎朝8時（JST）＝ 23:00 UTC
select cron.unschedule('push-morning') where exists (select 1 from cron.job where jobname = 'push-morning');
select cron.schedule('push-morning', '0 23 * * *', 'select public.push_morning()');