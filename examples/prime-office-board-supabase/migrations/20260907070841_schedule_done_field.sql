-- `plan` is what someone intends to do that day. Staff also want to record what
-- they actually did, so the two are kept apart rather than overwriting the plan.
alter table public.schedule add column if not exists done text not null default '';
