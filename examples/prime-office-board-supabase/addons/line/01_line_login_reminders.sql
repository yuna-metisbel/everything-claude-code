-- 追加機能：LINE でログイン・LINE への通知・リマインダー・ボードの名前を画面から変える。
--
-- migrations/ の35本を流したあとに、この機能を使うボードにだけ流す。
-- PRIME の本番には流していない（使っていない）。画面側は config.js の lineLogin が
-- 空なら、ここで足すものを一切呼ばないので、流していないボードでもそのまま動く。
--
-- 秘密（LINE のチャネルシークレットとアクセストークン）はここには置かない。
-- Edge Function の Secrets に、導入する人が自分で入れる（README.md）。

-- ---------------------------------------------------------------------------
-- 1. ボードの名前。config.js に書くと設置した人しか変えられないので、
--    本部の人が「設定」から変えられるよう DB に持つ。空なら config.js の値を使う。
alter table public.board_settings add column if not exists brand text not null default '';
alter table public.board_settings add column if not exists brand_sub text not null default '';

-- ログイン前の画面にも名前を出したいが、board_settings は招待コードと同じ行なので
-- 行ごとは開けない。名前の2つだけを返す。
create or replace function public.board_brand()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('brand', s.brand, 'sub', s.brand_sub)
       from public.board_settings s where s.id = 1),
    '{}'::jsonb)
$$;
revoke all on function public.board_brand() from public;
grant execute on function public.board_brand() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. LINE の利用者 ID とのひも付け。ログイン処理（service_role）だけが書く。
--    本人は「どの通知を LINE で受け取るか」だけを変えられる。
create table if not exists public.line_links (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  line_user_id text not null unique,
  display_name text not null default '',
  -- updates = お知らせ・予定の更新 / morning = 朝のまとめ（期限・支払い）
  -- before = 予定・会議の30分前 / remind = リマインダー
  notify       jsonb not null default '{"updates":true,"morning":true,"before":true,"remind":true}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.line_links enable row level security;
create policy line_links_own_read on public.line_links for select
  using (user_id = auth.uid());
create policy line_links_own_notify on public.line_links for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- 表単位の権限を剥がしてから、本人が書いてよい列だけを戻す
-- （列単位の revoke は、表単位の権限が残っていると効かない）。
revoke insert, update, delete on public.line_links from anon, authenticated;
grant update (notify, updated_at) on public.line_links to authenticated;

-- 公開してよい LINE 側の設定（チャネル ID・公式アカウントの ID・ボードの URL）。
-- 秘密ではないが、関数から読むので DB に置く。ポリシーなし＝ service_role だけが読む。
create table if not exists public.line_config (
  id               integer primary key default 1 check (id = 1),
  login_channel_id text not null default '',
  oa_basic_id      text not null default '',
  board_url        text not null default '',
  updated_at       timestamptz not null default now()
);
alter table public.line_config enable row level security;
insert into public.line_config (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. リマインダー。時刻になったら、本人（または選んだ人）の LINE に1回だけ送る。
create table if not exists public.reminders (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references public.members(id) on delete cascade,
  -- 空なら作った本人だけに送る。
  targets    uuid[] not null default '{}',
  remind_at  timestamptz not null,
  text       text not null check (length(btrim(text)) between 1 and 300),
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reminders_due_idx on public.reminders (remind_at) where sent_at is null;
alter table public.reminders enable row level security;
create policy reminders_read on public.reminders for select
  using (is_member() and (created_by = auth.uid() or auth.uid() = any (targets)));
create policy reminders_insert on public.reminders for insert
  with check (is_member() and created_by = auth.uid());
create policy reminders_update on public.reminders for update
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy reminders_delete on public.reminders for delete
  using (created_by = auth.uid());
alter publication supabase_realtime add table public.reminders;

-- 時刻で動く通知を二重に送らないための目印。cron は毎分動くので、
-- 「30分前」の窓に入っている間ずっと送り続けないようにここで止める。
create table if not exists public.notify_once (
  tag text primary key,
  at  timestamptz not null default now()
);
alter table public.notify_once enable row level security;

-- ---------------------------------------------------------------------------
-- 4. 宛先と種類を付けて送る。push_send（全員宛て）と同じ道を通り、Edge Function の
--    push が Web Push と LINE の両方に配る。LINE の無料枠は月200通（1人1通で1）なので、
--    全員宛てにしない・同じ話は tag でまとめる、を基本にする。
create or replace function public.push_send_to(
  p_members uuid[], p_kind text, p_title text, p_text text, p_url text, p_tag text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $$
declare
  secret text;
  fn_url text;
  fn_key text;
begin
  if p_members is null or cardinality(p_members) = 0 then return; end if;
  select send_secret, function_url, anon_key
    into secret, fn_url, fn_key
    from public.push_config where id = 1;
  if coalesce(secret, '') = '' or coalesce(fn_url, '') = '' or coalesce(fn_key, '') = '' then
    return;
  end if;
  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object('action', 'send', 'title', p_title, 'text', p_text,
                               'url', p_url, 'tag', p_tag, 'kind', p_kind,
                               'members', to_jsonb(p_members)),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || fn_key,
      'x-push-secret', secret)
  );
end $$;
revoke all on function public.push_send_to(uuid[], text, text, text, text, text) from public, anon, authenticated;

-- 「14:00」「14時」「14時30分」「17時以降」から時刻を取り出す。読めなければ null。
create or replace function public.parse_hhmm(p text)
returns time
language plpgsql
immutable
as $$
declare m text[];
begin
  m := regexp_match(coalesce(p, ''), '(\d{1,2})\s*(?:[:：]\s*(\d{2})|時\s*(?:(\d{1,2})\s*分)?)');
  if m is null then return null; end if;
  if m[1]::int > 23 then return null; end if;
  return make_time(m[1]::int, coalesce(m[2], m[3], '0')::int, 0);
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. 予定が書き換わったら、本人以外に知らせる。同じ人の同じ日の更新は1時間に1回に
--    まとめる（tag が同じなら push 側で2回目を捨てる）。
create or replace function public.schedule_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  who text;
  others uuid[];
  summary text;
begin
  if tg_op = 'UPDATE' and new.kind is not distinct from old.kind
     and new.plan is not distinct from old.plan
     and new.from_time is not distinct from old.from_time
     and new.to_time is not distinct from old.to_time then
    return new;  -- 「やったこと」やメモだけの書き換えでは鳴らさない
  end if;
  select name into who from public.members where id = new.member_id;
  select array_agg(id) into others from public.members
   where id <> new.member_id and id is distinct from new.updated_by;
  summary := to_char(new.date, 'MM/DD') ||
    case when coalesce(new.from_time, '') <> '' then ' ' || new.from_time ||
      case when coalesce(new.to_time, '') <> '' then '〜' || new.to_time else '' end
    else '' end ||
    case when coalesce(new.plan, '') <> '' then ' ' || left(new.plan, 60) else '' end;
  perform public.push_send_to(others, 'updates',
    coalesce(who, '誰か') || 'さんの予定が更新されました', summary, '/',
    'sched-' || new.member_id || '-' || new.date || '-' ||
      to_char(now() at time zone 'Asia/Tokyo', 'YYYYMMDDHH24'));
  return new;
end $$;
drop trigger if exists schedule_notify_trg on public.schedule;
create trigger schedule_notify_trg after insert or update on public.schedule
  for each row execute function public.schedule_notify();

-- やることの担当になったら、その人に知らせる（自分で自分に振ったときは鳴らさない）。
create or replace function public.task_assign_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.assignee is null or new.assignee = auth.uid() then return new; end if;
  if tg_op = 'UPDATE' and new.assignee is not distinct from old.assignee then return new; end if;
  perform public.push_send_to(array[new.assignee], 'updates',
    'やることの担当になりました',
    new.title || case when new.due is not null then '（期限 ' || to_char(new.due, 'MM/DD') || '）' else '' end,
    '/', 'task-assign-' || new.id || '-' || new.assignee);
  return new;
end $$;
drop trigger if exists task_assign_notify_trg on public.tasks;
create trigger task_assign_notify_trg after insert or update on public.tasks
  for each row execute function public.task_assign_notify();

-- お知らせの通知は全員宛て（push_send）のまま、種類だけ updates として扱われる
-- （push 側で kind が無いものは updates とみなす）。

-- ---------------------------------------------------------------------------
-- 6. 毎分：時刻になったリマインダーと、30分前の予定・会議。
create or replace function public.family_tick()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  everyone uuid[];
  jst_now timestamp := now() at time zone 'Asia/Tokyo';
  starts timestamp;
begin
  -- リマインダー。先に sent_at を入れてから送る（失敗しても二度送りはしない）。
  for r in
    update public.reminders set sent_at = now()
     where sent_at is null and remind_at <= now() and remind_at > now() - interval '1 day'
    returning id, created_by, targets, text
  loop
    perform public.push_send_to(
      case when cardinality(r.targets) = 0 then array[r.created_by] else r.targets end,
      'remind', 'リマインダー', r.text, '/', 'rem-' || r.id);
  end loop;

  -- 会議（みんなの予定）の30分前は全員へ。
  select array_agg(id) into everyone from public.members;
  for r in
    select id, title, date, at_time, place from public.notices
     where kind = 'meeting' and date between jst_now::date and (jst_now + interval '1 hour')::date
       and public.parse_hhmm(at_time) is not null
  loop
    starts := r.date + public.parse_hhmm(r.at_time);
    if starts > jst_now and starts <= jst_now + interval '30 minutes' then
      insert into public.notify_once (tag) values ('pre-notice-' || r.id || '-' || starts)
        on conflict do nothing;
      if found then
        perform public.push_send_to(everyone, 'before',
          to_char(starts, 'HH24:MI') || 'から：' || r.title,
          coalesce(nullif(r.place, ''), ''), '/', 'pre-notice-' || r.id || '-' || starts);
      end if;
    end if;
  end loop;

  -- 自分の予定（開始時刻があるもの）の30分前は本人へ。
  for r in
    select s.member_id, s.date, s.from_time, s.plan from public.schedule s
     where s.date = jst_now::date and s.kind <> 'off'
       and public.parse_hhmm(s.from_time) is not null
  loop
    starts := r.date + public.parse_hhmm(r.from_time);
    if starts > jst_now and starts <= jst_now + interval '30 minutes' then
      insert into public.notify_once (tag) values ('pre-sched-' || r.member_id || '-' || starts)
        on conflict do nothing;
      if found then
        perform public.push_send_to(array[r.member_id], 'before',
          to_char(starts, 'HH24:MI') || 'から予定があります',
          coalesce(nullif(r.plan, ''), ''), '/', 'pre-sched-' || r.member_id || '-' || starts);
      end if;
    end if;
  end loop;

  delete from public.notify_once where at < now() - interval '3 days';
end $$;
revoke all on function public.family_tick() from public, anon, authenticated;

-- 朝8時（JST）：1人1通。今日・明日の会議、自分が担当で今日が期限のやること・支払い。
-- 何も無い人には送らない。全員共通のまとめ（push_morning）はこちらに置き換える。
create or replace function public.family_morning()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  jst_today date := (now() at time zone 'Asia/Tokyo')::date;
  m record;
  meet text;
  t text;
  p text;
  lines text[];
begin
  select string_agg(case when date = jst_today then '今日 ' else '明日 ' end ||
                    coalesce(nullif(at_time, '') || ' ', '') || title, '／' order by date, at_time)
    into meet from public.notices
   where kind = 'meeting' and date in (jst_today, jst_today + 1);
  for m in select id from public.members loop
    lines := '{}';
    if meet is not null then lines := lines || ('会議：' || meet); end if;
    select string_agg(title, '／') into t from public.tasks
     where status <> 'done' and due = jst_today and assignee = m.id;
    if t is not null then lines := lines || ('今日が期限：' || t); end if;
    select string_agg(title || case when amount > 0 then ' ¥' || to_char(amount, 'FM999,999,999') else '' end, '／')
      into p from public.payments
     where status <> 'paid' and due = jst_today and assignee = m.id;
    if p is not null then lines := lines || ('今日が支払期日：' || p); end if;
    if array_length(lines, 1) is null then continue; end if;
    perform public.push_send_to(array[m.id], 'morning',
      to_char(jst_today, 'MM/DD') || ' 今日のこと',
      left(array_to_string(lines, E'\n'), 400), '/', 'morning-' || m.id || '-' || jst_today);
  end loop;
end $$;
revoke all on function public.family_morning() from public, anon, authenticated;

select cron.unschedule('push-morning') where exists (select 1 from cron.job where jobname = 'push-morning');
select cron.unschedule('family-morning') where exists (select 1 from cron.job where jobname = 'family-morning');
select cron.unschedule('family-tick') where exists (select 1 from cron.job where jobname = 'family-tick');
select cron.schedule('family-morning', '0 23 * * *', 'select public.family_morning()');
select cron.schedule('family-tick', '* * * * *', 'select public.family_tick()');
