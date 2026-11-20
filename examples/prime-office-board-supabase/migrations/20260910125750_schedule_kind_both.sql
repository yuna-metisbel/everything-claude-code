-- 半分は在宅、半分は事務所という日がある。事務所か在宅かの二択だと、
-- どちらを選んでも実際と違う予定が共有されてしまう。
alter table public.schedule drop constraint if exists schedule_kind_check;
alter table public.schedule add constraint schedule_kind_check
  check (kind in ('', 'off', 'office', 'home', 'out', 'both'));