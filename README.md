# Covered

Pay a stranger's real bill. The money goes to the biller, never to the person.
Next.js 15 on **Cloudflare Workers** (OpenNext) · Supabase Postgres + Auth · Hyperdrive · R2 · Turnstile · Stripe Checkout · Claude vision · Resend.

## Architecture

| Concern | Where |
|---|---|
| App + server actions | Cloudflare Worker (`@opennextjs/cloudflare`, `nodejs_compat`, KV incremental cache) |
| Server-side SQL (money functions, admin queries) | `postgres.js` (max 5) via **Hyperdrive** as the `covered_app` role (`supabase/migrations/0005_app_role.sql`) |
| Auth + RLS-scoped reads | `@supabase/ssr` in middleware (edge runtime) and server components |
| Bill images / payout proofs | Private R2 bucket `covered-bills`; presigned PUT in, short-lived presigned GET out (`src/lib/r2.ts`) |
| Bot protection | Turnstile on upload, checkout creation and sweep creation, verified server-side (`src/lib/turnstile.ts`) |
| Daily expiry + refunds | Workers Cron Trigger -> `worker.ts` `scheduled()` -> `/api/cron/expire` (needs `CRON_SECRET`) |

## Local setup

```bash
pnpm install
cp .env.example .env.local && cp .env.example .dev.vars    # fill in values
# Supabase: run supabase/migrations/*.sql in order, then:  alter role covered_app password '<strong password>';
pnpm dev                                                    # bindings are emulated by wrangler
stripe listen --forward-to localhost:3000/api/stripe/webhook
ALLOW_SEED=1 pnpm seed                                      # 30 live bills. NON-production databases only.
```
Test card `4242 4242 4242 4242`. Turnstile dev keys that always pass are listed in `.env.example`.

## Tests

```bash
export TEST_DATABASE_URL=postgres://postgres@localhost:5432/covered_test   # empty Postgres 15+ database
pnpm test
```
Covers: concurrent covers never overfund (loser gets the excess), sweep allocation/idempotency, RLS (anon can't read `image_path`, requester ids, tokens, emails), the `covered_app` role's least-privilege grants, and the same money functions driven through postgres.js as `covered_app`.
To run against a remote database, point `TEST_DATABASE_URL` at a **scratch** database: the suites drop and recreate `public` and `auth` (the Supabase stub). Never point it at your real project.

## Deploy to Cloudflare (what to run by hand)

```bash
# 1. Resources
pnpm wrangler kv namespace create covered-cache                 # paste id into wrangler.jsonc
pnpm wrangler r2 bucket create covered-bills
pnpm wrangler r2 bucket cors put covered-bills --file r2-cors.json   # see below
pnpm wrangler hyperdrive create covered \
  --connection-string="postgres://covered_app:PASSWORD@db.<ref>.supabase.co:5432/postgres"   # paste id into wrangler.jsonc
# R2 API token (Object Read & Write on covered-bills) -> R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
# Turnstile widget (Dashboard > Turnstile) -> site key (build-time) + secret

# 2. Secrets (one command each; values are prompted, never in git)
for n in SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET \
         ANTHROPIC_API_KEY RESEND_API_KEY EMAIL_FROM R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY \
         TURNSTILE_SECRET_KEY CRON_SECRET; do pnpm wrangler secret put $n; done

# 3. Build-time public values: put NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, NEXT_PUBLIC_TURNSTILE_SITE_KEY, NEXT_PUBLIC_SITE_URL in .env.production
pnpm deploy
```
`r2-cors.json` (allow the browser's direct PUT from your site origin):
```json
[{ "AllowedOrigins": ["https://covered.<subdomain>.workers.dev"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
```
Then: Supabase Auth > URL Configuration: add the workers.dev URL and `http://localhost:3000`. Stripe webhook: `https://<worker>/api/stripe/webhook` for `checkout.session.completed` and `charge.refunded`.

## Make yourself admin

Sign in once at `/receipts`, then in the Supabase SQL editor:
```sql
update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');
```

## Notes

- Bills are capped at $1,500. The UI says "reviewed by our team", not "ID checked": there is no KYC in v1.
- Payouts to billers are manual in v1 (`/admin/payouts`) behind `BillPayProvider` (`src/lib/payout.ts`).
- `TODO(v2)`: recurring sweeps, match pools, leaderboards, automated biller payments, KYC, i18n, reconciling dashboard refunds.
