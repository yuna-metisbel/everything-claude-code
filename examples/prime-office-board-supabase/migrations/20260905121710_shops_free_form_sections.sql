-- Shops turned out not to share a field set: one sheet lists 12 headings, another
-- lists 30, and the office pastes whichever ■ block it already has. Replace the
-- fixed columns with an ordered list of {label, value} so any heading survives.
alter table public.shops add column if not exists sections jsonb not null default '[]'::jsonb;

-- carry the existing row over, in the order the office wrote it
update public.shops
set sections = (
  select coalesce(jsonb_agg(jsonb_build_object('label', s.label, 'value', s.value)
                            order by s.ord), '[]'::jsonb)
  from (
    values
      (1,  '営業時間',         hours),
      (2,  '最寄り駅',         station),
      (3,  '送り迎え',         pickup),
      (4,  '採用基準',         hiring),
      (5,  '女子給',           pay),
      (6,  '指名料',           nomination),
      (7,  '雑費',             misc),
      (8,  '待機',             standby),
      (9,  '必要な身分証の種類', id_docs),
      (10, '講習の有無',       training),
      (11, 'PR',               pr),
      (12, 'その他メモ',       note)
  ) as s(ord, label, value)
  where btrim(s.value) <> ''
)
where sections = '[]'::jsonb;

alter table public.shops
  drop column if exists hours,
  drop column if exists station,
  drop column if exists pickup,
  drop column if exists hiring,
  drop column if exists pay,
  drop column if exists nomination,
  drop column if exists misc,
  drop column if exists standby,
  drop column if exists id_docs,
  drop column if exists training,
  drop column if exists pr,
  drop column if exists note;
