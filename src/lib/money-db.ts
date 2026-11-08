import type postgres from "postgres";

// Thin typed wrappers over the SECURITY DEFINER money functions. They take a postgres.js client so the same
// code runs on Workers (Hyperdrive) and in the test suite. No "server-only" so tests can import it.
type Sql = postgres.Sql;

export type ApplyResult = { contribution_id: string; applied_cents: number; excess_cents: number; bill_funded: boolean; duplicate: boolean };
export type SweepRow = { bill_id: string; applied_cents: number; biller_name: string; city: string; category: string };

export async function applyContribution(sql: Sql, a: { billId: string; cents: number; email: string | null; giverId: string | null; paymentIntent: string; feeCents: number; sweepId?: string | null }): Promise<ApplyResult> {
  const [r] = await sql<ApplyResult[]>`select * from apply_contribution(${a.billId}::uuid, ${a.cents}::int, ${a.email}, ${a.giverId}::uuid, ${a.paymentIntent}, ${a.feeCents}::int, ${a.sweepId ?? null}::uuid)`;
  return r;
}
export const recordRefund = (sql: Sql, contributionId: string, cents: number) =>
  sql`select record_refund(${contributionId}::uuid, ${cents}::int)`;

export const allocateSweep = (sql: Sql, sweepId: string, paymentIntent: string) =>
  sql<SweepRow[]>`select bill_id, applied_cents, biller_name, city, category from allocate_sweep(${sweepId}::uuid, ${paymentIntent})`;
export const recordSweepRefund = (sql: Sql, sweepId: string, cents: number) =>
  sql`select record_sweep_refund(${sweepId}::uuid, ${cents}::int)`;

export const expireBills = (sql: Sql) =>
  sql<{ contribution_id: string; payment_intent: string; refundable_cents: number; bill_id: string }[]>`select * from expire_bills()`;

export async function hitRateLimit(sql: Sql, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select hit_rate_limit(${key}, ${limit}::int, ${windowSeconds}::int) as ok`;
  return r.ok;
}

/** Claim a Stripe event id. True only for the first delivery. */
export async function claimEvent(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`insert into stripe_events (id) values (${id}) on conflict do nothing returning id`;
  return r.length > 0;
}
export const unclaimEvent = (sql: Sql, id: string) => sql`delete from stripe_events where id = ${id}`;
