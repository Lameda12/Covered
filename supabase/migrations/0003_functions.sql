-- Money-moving functions. SECURITY DEFINER, callable only by the service role.

-- Apply a paid contribution to a bill. Locks the bill row so concurrent givers serialize.
-- Returns what was applied, what must be refunded (race loser / bill no longer live), and whether the bill is now full.
create function public.apply_contribution(
  p_bill_id uuid,
  p_amount_cents int,
  p_giver_email text,
  p_giver_id uuid,
  p_payment_intent text,
  p_fee_cents int default 0,
  p_sweep_id uuid default null
) returns table (contribution_id uuid, applied_cents int, excess_cents int, bill_funded boolean, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  b public.bills%rowtype;
  existing public.contributions%rowtype;
  v_remaining int;
  v_applied int;
  v_id uuid;
begin
  if p_amount_cents <= 0 then raise exception 'amount must be positive'; end if;

  -- idempotency: same payment intent + bill is applied once
  select * into existing from public.contributions
    where stripe_payment_intent = p_payment_intent and bill_id = p_bill_id;
  if found then
    select (funded_cents >= amount_cents) into bill_funded from public.bills where id = p_bill_id;
    return query select existing.id, existing.amount_cents, existing.requested_cents - existing.amount_cents, bill_funded, true;
    return;
  end if;

  select * into b from public.bills where id = p_bill_id for update;
  if not found then raise exception 'bill not found'; end if;

  v_remaining := case when b.status = 'live' then b.amount_cents - b.funded_cents else 0 end;
  v_applied := greatest(0, least(p_amount_cents, v_remaining));

  insert into public.contributions
    (bill_id, giver_id, giver_email, amount_cents, requested_cents, fee_cents, stripe_payment_intent, sweep_id, note)
  values
    (p_bill_id, p_giver_id, p_giver_email, v_applied, p_amount_cents, p_fee_cents, p_payment_intent, p_sweep_id,
     case when v_applied < p_amount_cents then 'excess refunded: bill was already funded or no longer live' end)
  returning id into v_id;

  if v_applied > 0 then
    update public.bills
      set funded_cents = funded_cents + v_applied,
          status = case when funded_cents + v_applied >= amount_cents then 'funded' else status end
      where id = p_bill_id
      returning (status = 'funded') into bill_funded;
  else
    bill_funded := (b.funded_cents >= b.amount_cents);
  end if;

  return query select v_id, v_applied, p_amount_cents - v_applied, bill_funded, false;
end $$;

-- Record that an excess was refunded on Stripe.
create function public.record_refund(p_contribution_id uuid, p_refunded_cents int) returns void
language sql security definer set search_path = public as $$
  update public.contributions set refunded_cents = refunded_cents + p_refunded_cents where id = p_contribution_id;
$$;

-- Fill live bills matching the sweep filters, most urgent first, until the budget runs out.
-- filters: { categories?: text[], cities?: text[], max_bill_cents?: int, due_within_days?: int }
-- Each bill is covered in full (what is still owed); bills that no longer fit the budget are skipped.
create function public.allocate_sweep(p_sweep_id uuid, p_payment_intent text)
returns table (bill_id uuid, applied_cents int, biller_name text, city text, category text, leftover_cents int)
language plpgsql security definer set search_path = public as $$
declare
  s public.sweeps%rowtype;
  f jsonb;
  r record;
  v_left int;
  v_rem int;
begin
  select * into s from public.sweeps where id = p_sweep_id for update;
  if not found then raise exception 'sweep not found'; end if;
  if s.status <> 'awaiting_payment' then
    -- already processed: report the same leftover, no new allocation
    return query
      select c.bill_id, c.amount_cents, b.biller_name, b.city, b.category, s.budget_cents - s.allocated_cents
      from public.contributions c join public.bills b on b.id = c.bill_id
      where c.sweep_id = p_sweep_id;
    return;
  end if;

  f := s.filters;
  v_left := s.budget_cents;

  for r in
    select b.* from public.bills b
    where b.status = 'live'
      and b.funded_cents < b.amount_cents
      and (f->'categories' is null or jsonb_array_length(f->'categories') = 0 or b.category in (select jsonb_array_elements_text(f->'categories')))
      and (f->'cities' is null or jsonb_array_length(f->'cities') = 0 or lower(b.city) in (select lower(jsonb_array_elements_text(f->'cities'))))
      and (f->>'max_bill_cents' is null or (b.amount_cents - b.funded_cents) <= (f->>'max_bill_cents')::int)
      and (f->>'due_within_days' is null or b.due_date <= current_date + (f->>'due_within_days')::int)
    order by b.due_date, (b.amount_cents - b.funded_cents), b.id
    for update of b
  loop
    v_rem := r.amount_cents - r.funded_cents;
    continue when v_rem > v_left;

    insert into public.contributions
      (bill_id, giver_id, giver_email, amount_cents, requested_cents, stripe_payment_intent, sweep_id)
    values (r.id, s.giver_id, s.giver_email, v_rem, v_rem, p_payment_intent, p_sweep_id);

    update public.bills set funded_cents = amount_cents, status = 'funded' where id = r.id;
    v_left := v_left - v_rem;

    bill_id := r.id; applied_cents := v_rem; biller_name := r.biller_name; city := r.city; category := r.category;
    leftover_cents := 0;
    return next;
  end loop;

  update public.sweeps
    set allocated_cents = budget_cents - v_left,
        status = 'allocated',
        stripe_payment_intent = coalesce(p_payment_intent, stripe_payment_intent)
    where id = p_sweep_id;
end $$;

create function public.record_sweep_refund(p_sweep_id uuid, p_refunded_cents int) returns void
language sql security definer set search_path = public as $$
  update public.sweeps set refunded_cents = refunded_cents + p_refunded_cents, status = 'complete' where id = p_sweep_id;
$$;

-- Expire bills 7 days after their due date. Returns contributions that need refunding.
create function public.expire_bills() returns table (contribution_id uuid, payment_intent text, refundable_cents int, bill_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  update public.bills set status = 'expired'
    where status in ('live','pending_review') and due_date + 7 < current_date;
  return query
    select c.id, c.stripe_payment_intent, c.amount_cents - c.refunded_cents, c.bill_id
    from public.contributions c join public.bills b on b.id = c.bill_id
    where b.status = 'expired' and c.amount_cents - c.refunded_cents > 0 and c.stripe_payment_intent is not null;
end $$;

-- Fixed-window rate limiter. Returns true when the call is allowed.
create function public.hit_rate_limit(p_key text, p_limit int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c int;
begin
  insert into public.rate_limits (key, window_start, count) values (p_key, w, 1)
    on conflict (key, window_start) do update set count = public.rate_limits.count + 1
    returning count into c;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return c <= p_limit;
end $$;

-- Lock the money functions down to the service role.
revoke all on function public.apply_contribution(uuid,int,text,uuid,text,int,uuid) from public, anon, authenticated;
revoke all on function public.record_refund(uuid,int) from public, anon, authenticated;
revoke all on function public.allocate_sweep(uuid,text) from public, anon, authenticated;
revoke all on function public.record_sweep_refund(uuid,int) from public, anon, authenticated;
revoke all on function public.expire_bills() from public, anon, authenticated;
revoke all on function public.hit_rate_limit(text,int,int) from public, anon, authenticated;
grant execute on function public.apply_contribution(uuid,int,text,uuid,text,int,uuid) to service_role;
grant execute on function public.record_refund(uuid,int) to service_role;
grant execute on function public.allocate_sweep(uuid,text) to service_role;
grant execute on function public.record_sweep_refund(uuid,int) to service_role;
grant execute on function public.expire_bills() to service_role;
grant execute on function public.hit_rate_limit(text,int,int) to service_role;
