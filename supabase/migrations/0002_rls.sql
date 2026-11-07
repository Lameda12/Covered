-- Row Level Security. Default deny everywhere; the service role bypasses RLS.

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.bills enable row level security;
alter table public.contributions enable row level security;
alter table public.sweeps enable row level security;
alter table public.thank_yous enable row level security;
alter table public.stripe_events enable row level security;
alter table public.rate_limits enable row level security;

-- profiles: own row (role cannot be self-escalated: see trigger), admins see all
create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on public.profiles for all using (public.is_admin()) with check (public.is_admin());

create function public.block_role_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.role() is null for direct DB access (migrations, SQL editor); 'service_role' for the service key.
  if new.role is distinct from old.role and not (
       auth.role() is null or auth.role() = 'service_role' or public.is_admin()) then
    raise exception 'role cannot be changed';
  end if;
  return new;
end $$;
create trigger profiles_no_escalation before update on public.profiles
  for each row execute function public.block_role_escalation();

-- bills: requesters read their own rows in full; admins everything.
-- Writes by requesters go through server actions (service role) so state transitions are controlled.
create policy bills_owner_read on public.bills for select using (requester_id = auth.uid());
create policy bills_admin_all on public.bills for all using (public.is_admin()) with check (public.is_admin());

-- contributions: giver may read their own; inserts only via service role (no insert policy)
create policy contributions_own_read on public.contributions for select
  using (giver_id = auth.uid() or public.is_admin());
create policy sweeps_own_read on public.sweeps for select
  using (giver_id = auth.uid() or public.is_admin());

-- thank_yous: requester reads own bill's; givers see them via server
create policy thank_yous_owner_read on public.thank_yous for select
  using (exists (select 1 from public.bills b where b.id = bill_id and b.requester_id = auth.uid()) or public.is_admin());

-- stripe_events / rate_limits: no policies => service role only

-- Public, safe projection of live bills. Runs as the view owner so anon needs no table access.
-- Deliberately excludes image_path, requester_id, status_token, payment info.
create view public.public_bills with (security_invoker = false) as
  select id, category, biller_name, account_last4, amount_cents, funded_cents,
         due_date, city, first_name, note, status, created_at
  from public.bills
  where status = 'live';

revoke all on all tables in schema public from anon, authenticated;
grant select on public.public_bills to anon, authenticated;
grant select on public.profiles, public.bills, public.contributions, public.sweeps, public.thank_yous to authenticated;
grant update (display_name, is_anonymous) on public.profiles to authenticated;
grant insert, update, delete on public.bills to authenticated; -- gated by bills_admin_all only
grant insert, update, delete on public.profiles to authenticated;

-- Storage: private bucket, owner folder = auth.uid(); admins read all.
insert into storage.buckets (id, name, public) values ('bills', 'bills', false) on conflict (id) do nothing;
create policy "bill images: owner read" on storage.objects for select to authenticated
  using (bucket_id = 'bills' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "bill images: owner upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'bills' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "bill images: admin all" on storage.objects for all to authenticated
  using (bucket_id = 'bills' and public.is_admin()) with check (bucket_id = 'bills' and public.is_admin());
