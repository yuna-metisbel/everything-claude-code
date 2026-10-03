-- push_send にプロジェクトの URL と anon キーが直書きされていた。
-- 1社1プロジェクトで配る以上、ここが固定だと2社目のDBで別の会社の
-- Edge Function を叩いてしまう（少なくとも動かない）。設定値として外に出す。
--
-- 値は導入時に入れる。push_config はポリシーが1つも無いので、
-- ここに置いた鍵はクライアントからは読めない。
alter table public.push_config add column if not exists function_url text not null default '';
alter table public.push_config add column if not exists anon_key text not null default '';

create or replace function public.push_send(p_title text, p_text text, p_url text, p_tag text)
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
  select send_secret, function_url, anon_key
    into secret, fn_url, fn_key
    from public.push_config where id = 1;
  -- 未設定のまま呼ばれても、黙って何もしない。通知が来ないだけで、
  -- 書き込み自体（お知らせの登録など）は失敗させない。
  if coalesce(secret, '') = '' or coalesce(fn_url, '') = '' or coalesce(fn_key, '') = '' then
    return;
  end if;
  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object('action', 'send', 'title', p_title,
                               'text', p_text, 'url', p_url, 'tag', p_tag),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || fn_key,
      'x-push-secret', secret)
  );
end $$;
revoke all on function public.push_send(text, text, text, text) from public, anon, authenticated;