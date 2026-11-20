-- メモ：お知らせと同じ「全員が見るもの」だが、日付も通知も無い覚え書き。
-- 表は分けない。お知らせ（notice）・会議（meeting）と同じ notices に
-- kind='memo' で置く。画面側では一覧にもカレンダーにも出さない。
alter table public.notices drop constraint if exists notices_kind_check;
alter table public.notices add constraint notices_kind_check
  check (kind in ('notice', 'meeting', 'memo'));

-- メモは書いても鳴らさない。鳴る欄が欲しいなら、お知らせのほうを使う。
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
  if new.kind = 'memo' then return new; end if;
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
