-- Covered v1 schema
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','admin')),
  display_name text,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);

-- auto-create a profile for every auth user
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id),
  status text not null default 'pending_review' check (status in
    ('pending_review','live','funded','paying','paid','rejected','expired')),
  category text not null check (category in
    ('rent','electric','heat','water','internet','phone','medical','childcare','car')),
  biller_name text not null check (length(biller_name) between 1 and 80),
  account_last4 text check (account_last4 ~ '^[0-9A-Za-z]{2,4}$'),
  amount_cents int not null check (amount_cents between 100 and 150000),
  funded_cents int not null default 0 check (funded_cents >= 0),
  due_date date not null,
  city text not null check (length(city) between 1 and 40),
  first_name text not null check (length(first_name) between 1 and 30),
  note text check (length(note) <= 140),
  image_path text,
  status_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  reject_reason text,
  payment_confirmation text,
  payment_proof_path text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funded_within_amount check (funded_cents <= amount_cents)
);
-- one open bill per requester
create unique index one_open_bill_per_requester on public.bills (requester_id)
  where status in ('pending_review','live','funded','paying');
create index bills_live_due on public.bills (due_date) where status = 'live';

create table public.sweeps (
  id uuid primary key default gen_random_uuid(),
  giver_id uuid references public.profiles(id),
  giver_email text,
  filters jsonb not null,
  budget_cents int not null check (budget_cents between 100 and 10000000),
  allocated_cents int not null default 0 check (allocated_cents >= 0),
  refunded_cents int not null default 0 check (refunded_cents >= 0),
  stripe_session_id text unique,
  stripe_payment_intent text,
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','allocated','complete','failed')),
  created_at timestamptz not null default now(),
  constraint sweep_within_budget check (allocated_cents + refunded_cents <= budget_cents)
);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id),
  giver_id uuid references public.profiles(id),
  giver_email text,
  amount_cents int not null check (amount_cents >= 0),       -- amount actually applied to the bill
  requested_cents int not null check (requested_cents >= 0), -- what the giver paid toward it
  refunded_cents int not null default 0 check (refunded_cents >= 0),
  fee_cents int not null default 0,
  note text,
  stripe_payment_intent text,
  sweep_id uuid references public.sweeps(id),
  created_at timestamptz not null default now(),
  unique (stripe_payment_intent, bill_id)
);
create index contributions_bill on public.contributions (bill_id);
create index contributions_email on public.contributions (lower(giver_email));

create table public.thank_yous (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null unique references public.bills(id),
  body text not null check (length(body) between 1 and 200),
  created_at timestamptz not null default now()
);

create table public.stripe_events (
  id text primary key,
  processed_at timestamptz not null default now()
);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger bills_touch before update on public.bills
  for each row execute function public.touch_updated_at();
