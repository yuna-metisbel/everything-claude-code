-- 追加機能：公式アカウントのトークに送られた要望・感想をボードに残す。
--
-- 02 のあとに流す。受け口は Edge Function line-webhook（LINE からの呼び出しを
-- チャネルシークレットの署名で確かめる）。書き込むのはその関数（service_role）だけ。
create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  line_user_id text not null default '',
  -- LINE でボードに入ったことがある人なら、その人。知らない人からでも受け取る。
  member_id    uuid references public.members(id) on delete set null,
  sender_name  text not null default '',
  body         text not null check (length(body) between 1 and 2000),
  done         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists feedback_recent_idx on public.feedback (done, created_at desc);

alter table public.feedback enable row level security;
-- 本部メンバーは読んで、対応済みにして、消せる。足すのは line-webhook だけ。
create policy feedback_read on public.feedback for select using (is_member());
create policy feedback_update on public.feedback for update using (is_member()) with check (is_member());
create policy feedback_delete on public.feedback for delete using (is_member());
revoke insert on public.feedback from anon, authenticated;
revoke update on public.feedback from anon, authenticated;
grant update (done) on public.feedback to authenticated;
alter publication supabase_realtime add table public.feedback;
