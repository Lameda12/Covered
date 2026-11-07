# Covered

Pay a stranger's real bill. The money goes to the biller, never to the person.
Next.js 15 (App Router) · Supabase (Postgres, Auth, Storage, RLS) · Stripe Checkout · Claude vision · Resend · Vercel.

## Local setup

```bash
pnpm install
cp .env.example .env.local        # fill in every value, see below
# Supabase: create a project, then run supabase/migrations/*.sql in order (SQL editor or `supabase db push`).
# The migration creates the private `bills` storage bucket and its policies.
pnpm dev
stripe listen --forward-to localhost:3000/api/stripe/webhook   # prints STRIPE_WEBHOOK_SECRET
ALLOW_SEED=1 pnpm seed            # 30 live bills across 8 cities. NON-production databases only.
```

Test card: `4242 4242 4242 4242`, any future date, any CVC.

### Tests

```bash
export TEST_DATABASE_URL=postgres://postgres@localhost:5432/covered_test   # any empty Postgres 15+ database
pnpm test
```
The DB suites apply a minimal Supabase stub plus all migrations, then test: concurrent covers never overfund (loser gets the excess back), sweep allocation and idempotency, and RLS (anon cannot read `image_path`, requester ids, tokens, emails or other users' bills). They skip when `TEST_DATABASE_URL` is unset.

## Environment variables

See `.env.example` (all documented). Set them for **Production and Preview** in Vercel.
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET` (+ optional `EMAIL_FROM`).

## Make yourself admin

Sign in once at `/receipts` with your email, then in the Supabase SQL editor:

```sql
update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');
```

## Deploy checklist (what must be clicked by hand)

1. **Supabase**: create project, run the 4 migrations, Auth > URL Configuration: add `https://<your-domain>` and `http://localhost:3000` (and `/auth/**` paths) to redirect URLs. Set Site URL.
2. **Vercel**: import the GitHub repo, add all env vars (Production + Preview). `vercel.json` already schedules `/api/cron/expire` daily; Vercel sends `Authorization: Bearer $CRON_SECRET`.
3. **Stripe**: add endpoint `https://<domain>/api/stripe/webhook` for `checkout.session.completed` and `charge.refunded`; copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. **Resend**: verify your sending domain and set `EMAIL_FROM`.
5. Run the admin SQL above.

## How money moves

1. `createCheckout` re-reads the bill, caps the amount at what's still owed, creates a Checkout Session (optional card-fee line).
2. Webhook verifies the signature, claims the event id in `stripe_events`, then `apply_contribution` locks the bill row (`for update`), applies `min(amount, remaining)`, and the excess is refunded through Stripe with an idempotency key.
3. Sweeps charge the whole budget once; `allocate_sweep` fills bills by due date under row locks; leftover is refunded; the giver gets a receipt.
4. Payouts are manual in v1 (`/admin/payouts`) behind the `BillPayProvider` interface (`src/lib/payout.ts`).
5. Daily cron expires bills 7 days past due and refunds contributions.

## Notes

- Bills are capped at $1,500. The UI says "reviewed by our team" (admin review), not "ID checked": there is no KYC in v1.
- `TODO(v2)` markers: recurring sweeps, match pools, leaderboards, automated biller payments, KYC, i18n, dashboard refund reconciliation.
