-- Payments started as "what is coming up". Staff also buy things out of pocket and
-- want to log them after the fact for the books, so an already-paid row needs the
-- date it was actually spent and a category to total by.
alter table public.payments add column if not exists category text not null default '';
alter table public.payments add column if not exists paid_on date;

-- back-fill the spend date for rows already marked paid
update public.payments
set paid_on = (paid_at at time zone 'Asia/Tokyo')::date
where status = 'paid' and paid_on is null and paid_at is not null;

create index if not exists payments_paid_on_idx on public.payments (paid_on);
create index if not exists payments_category_idx on public.payments (category);
