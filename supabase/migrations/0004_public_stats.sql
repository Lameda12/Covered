-- Aggregate numbers for the header ("covered this week"). No row-level data is exposed.
create view public.public_stats with (security_invoker = false) as
  select
    coalesce((select sum(amount_cents) from public.contributions where created_at > now() - interval '7 days'), 0)::bigint as week_cents,
    (select count(*) from public.bills where status in ('funded','paying','paid') and updated_at > now() - interval '7 days')::int as week_bills;
grant select on public.public_stats to anon, authenticated;
