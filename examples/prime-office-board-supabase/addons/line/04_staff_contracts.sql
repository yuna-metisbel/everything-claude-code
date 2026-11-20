-- 追加機能：スタッフの契約書（リンクだけ）。
--
-- 01〜03 のあとに流す。PRIME の本番には流していない。画面側は config.js の
-- contracts が無ければ一切呼ばないので、流していないボードは今までどおり動く。
--
-- 契約書の実体（PDF・原本）はここに置かない。置き場所（Google ドライブ、
-- 自社の管理画面など）の URL と、いまどの段階かだけを持つ。
-- ユーザーの選択：「リンクだけ」。

-- staff 表に列を足さないのは意図的。あの表は4桁の暗証番号（pin）を隠すために
-- 表単位の権限を剥がし、見せてよい列だけを grant し直してある
-- （migrations/20260907171420 と 20260907205641）。列を足すとその作業を
-- やり直すことになり、間違えると pin が読める形に戻る。別の表なら
-- RLS をここだけで書き切れる。
create table if not exists public.staff_contracts (
  staff_id   uuid primary key references public.staff(id) on delete cascade,
  site_id    uuid not null references public.sites(id) on delete cascade,
  url        text not null default '',
  -- none = 未送付 / sent = 送付済み / signed = 締結済み
  status     text not null default 'none' check (status in ('none', 'sent', 'signed')),
  note       text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members(id) on delete set null
);
create index if not exists staff_contracts_site_idx on public.staff_contracts (site_id, status);

alter table public.staff_contracts enable row level security;

-- 読めるのは本部と、本人の1行だけ。拠点が同じでも他人の契約書は見えない
-- （店長にも見せない。契約は本部とその人のあいだのものなので）。
create policy staff_contracts_read on public.staff_contracts for select
  using (public.is_member() or staff_id = public.staff_me());

-- 書けるのは本部だけ。
create policy staff_contracts_write on public.staff_contracts for all
  using (public.is_member()) with check (public.is_member());

-- realtime には入れない。staff を入れていないのと同じ理由で、
-- 行ごとの絞り込みが配信にどこまで効くかを確かめられていない。
-- 契約書は頻繁に変わらないので、画面に戻ったときの読み直しで足りる。
