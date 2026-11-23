-- 追加機能：書類にサイン。
--
-- 01〜04 のあとに流す。画面側は config.js の docs が無ければ一切呼ばないので、
-- 流していないボードは今までどおり動く。
--
-- 書類の実体（PDF・原本）はここに置かない。04_staff_contracts.sql と同じで、
-- 置き場所（Google ドライブ・管理画面など）の URL を持つだけ。
-- 置くのは「誰が・いつ・何に同意して・どう署名したか」のほう。
--
-- サインするのは本部のメンバー（members）。拠点のスタッフ（staff）は認証の系統が
-- 別で、契約書は 04 の staff_contracts が受け持っている。混ぜない。

create table if not exists public.docs (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default '',
  -- 書類の置き場所。読む人はここを開いて中身を確かめる。
  url          text not null default '',
  -- 画面に添える説明（任意）。URL を開かなくても何の書類か分かるように。
  body         text not null default '',
  -- サインの欄に何を書いてもらうか。氏名は必ず要る（紙の書類がそうなっている）。
  need_address boolean not null default true,
  need_contact boolean not null default true,
  due          date,
  -- しまった書類は、サイン済みの控えを残したまま一覧から下げる。
  active       boolean not null default true,
  created_by   uuid references public.members(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists docs_active_idx on public.docs (active, created_at desc);

create table if not exists public.doc_signs (
  doc_id    uuid not null references public.docs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  -- draw = 指やマウスで書いた / type = 名前を打ち込んだ
  kind      text not null default 'draw' check (kind in ('draw', 'type')),
  -- 手書きの線を PNG にしたもの（data:image/png;base64,…）。打ち込みのときは空。
  -- 画面側でも長さを見ているが、表のほうでも上限を持つ（行が無限に太らないように）。
  image     text not null default '' check (length(image) <= 400000),
  name      text not null default '',
  address   text not null default '',
  contact   text not null default '',
  signed_at timestamptz not null default now(),
  primary key (doc_id, member_id)
);

alter table public.docs enable row level security;
alter table public.doc_signs enable row level security;

-- 書類そのものは本部の全員が読み書きできる。小さな事務所で、出す人と
-- 直す人を分ける意味がないため（他の表と同じ考え方）。
create policy docs_read on public.docs for select
  using (public.is_member());
create policy docs_write on public.docs for all
  using (public.is_member()) with check (public.is_member());

-- 誰がサインしたかは本部の全員が見る。「まだの人がいるか」を確かめるための
-- 機能なので、ここを本人だけにすると意味がなくなる。
-- 住所・連絡先も一緒に見えるため、画面にその旨を出している。
create policy doc_signs_read on public.doc_signs for select
  using (public.is_member());

-- 書けるのは自分の1行だけ。人のサインは作れないし、直せないし、消せない。
create policy doc_signs_mine on public.doc_signs for all
  using (public.is_member() and member_id = auth.uid())
  with check (public.is_member() and member_id = auth.uid());

-- 新しい書類が出たら知らせる。サインは待たせると止まるので、
-- 「出したつもりが誰も気づいていない」をなくす。
-- push を入れていないボードでも流せるよう、関数が無ければ何もしない。
create or replace function public.docs_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.active and to_regprocedure('public.push_send(text,text,text,text)') is not null then
    perform public.push_send('サインしてほしい書類',
      new.title, '/', 'doc-' || new.id::text);
  end if;
  return new;
end $$;

drop trigger if exists docs_push_ins on public.docs;
create trigger docs_push_ins after insert on public.docs
  for each row execute function public.docs_push();

-- realtime には入れない。04 と同じ理由で、書類は頻繁に変わらないので
-- 画面に戻ったときの読み直しで足りる。
