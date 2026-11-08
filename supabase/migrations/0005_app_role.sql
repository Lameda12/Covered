-- Least-privilege role for the Cloudflare Worker's server-side SQL (via Hyperdrive).
-- Set its password out of band (never in git):  alter role covered_app password '...';
do $$ begin
  if not exists (select from pg_roles where rolname = 'covered_app') then
    create role covered_app login noinherit nosuperuser nocreatedb nocreaterole;
  end if;
end $$;

grant usage on schema public to covered_app;
revoke all on all tables in schema public from covered_app;

grant select, insert, update on public.bills to covered_app;       -- no delete
grant select, insert, update on public.sweeps to covered_app;
grant select, insert on public.thank_yous to covered_app;
grant select on public.contributions, public.profiles to covered_app;
grant select, insert, delete on public.stripe_events to covered_app;
grant select on public.public_bills, public.public_stats to covered_app;
-- rate_limits: reachable only through hit_rate_limit()

-- RLS is on for every table, so the role needs explicit policies matching the grants above.
create policy app_bills on public.bills to covered_app using (true) with check (true);
create policy app_sweeps on public.sweeps to covered_app using (true) with check (true);
create policy app_thanks on public.thank_yous to covered_app using (true) with check (true);
create policy app_contrib_read on public.contributions for select to covered_app using (true);
create policy app_profiles_read on public.profiles for select to covered_app using (true);
create policy app_events on public.stripe_events to covered_app using (true) with check (true);

grant execute on function public.apply_contribution(uuid,int,text,uuid,text,int,uuid) to covered_app;
grant execute on function public.record_refund(uuid,int) to covered_app;
grant execute on function public.allocate_sweep(uuid,text) to covered_app;
grant execute on function public.record_sweep_refund(uuid,int) to covered_app;
grant execute on function public.expire_bills() to covered_app;
grant execute on function public.hit_rate_limit(text,int,int) to covered_app;

-- image/proof keys now point into R2
alter table public.bills drop column if exists payment_proof_path;
alter table public.bills add column payment_proof_key text;
