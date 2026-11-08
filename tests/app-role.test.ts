import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "@/lib/db-core";
import { allocateSweep, applyContribution, claimEvent, expireBills, hitRateLimit, unclaimEvent } from "@/lib/money-db";
import { createBill, createUser, makePool, resetDb, TEST_DB_URL } from "./helpers/db";

// Same code path as production: postgres.js client (max 5) connected as the least-privilege covered_app role.
// Locally this goes straight to Postgres; on Workers the only difference is the Hyperdrive connection string.
const d = TEST_DB_URL ? describe : describe.skip;
const admin = makePool();

d("money functions as covered_app via postgres.js", () => {
  const sql = TEST_DB_URL ? (() => { const u = new URL(TEST_DB_URL); u.username = "covered_app"; u.password = "x"; return connect(u.toString()); })() : (null as never);
  let requester: string;
  beforeAll(async () => { await resetDb(admin); await admin.query("alter role covered_app password 'x'"); });
  afterAll(async () => { await sql.end(); await admin.end(); });

  it("simultaneous covers (separate pooled connections) never overfund", async () => {
    requester = await createUser(admin, "r@x.com");
    const bill = await createBill(admin, requester, { amount: 20000 });
    const run = (pi: string) => applyContribution(sql, { billId: bill, cents: 20000, email: `${pi}@x.com`, giverId: null, paymentIntent: pi, feeCents: 0 });
    const res = await Promise.all([run("pi_a"), run("pi_b"), run("pi_c"), run("pi_d")]);
    expect(res.map((r) => r.applied_cents).sort((a, b) => a - b)).toEqual([0, 0, 0, 20000]);
    expect(res.reduce((s, r) => s + r.excess_cents, 0)).toBe(60000);
    const [b] = await sql`select status, funded_cents from bills where id = ${bill}::uuid`;
    expect(b).toMatchObject({ status: "funded", funded_cents: 20000 });
  });

  it("returns dates as plain strings", async () => {
    const [r] = await sql`select due_date from bills limit 1`;
    expect(typeof r.due_date).toBe("string");
  });

  it("sweep allocation + idempotency + expiry list", async () => {
    await admin.query("delete from contributions; delete from sweeps; delete from bills; delete from auth.users;");
    for (let i = 0; i < 5; i++) await createBill(admin, await createUser(admin, `s${i}@x.com`), { amount: 10000, category: "water" });
    const [sw] = await sql`insert into sweeps (giver_email, filters, budget_cents) values ('g@x.com', ${sql.json({ categories: ["water"] })}, 35000) returning id`;
    const rows = await allocateSweep(sql, sw.id, "pi_s");
    expect(rows).toHaveLength(3);
    expect(await allocateSweep(sql, sw.id, "pi_s")).toHaveLength(3); // re-run is a no-op
    const [s] = await sql`select allocated_cents from sweeps where id = ${sw.id}::uuid`;
    expect(s.allocated_cents).toBe(30000);
    await admin.query("update bills set due_date = current_date - 10 where status='live'");
    await admin.query("update bills set status='live' where status='funded' and false");
    expect(Array.isArray(await expireBills(sql))).toBe(true);
  });

  it("event claims and rate limits", async () => {
    expect(await claimEvent(sql, "evt_1")).toBe(true);
    expect(await claimEvent(sql, "evt_1")).toBe(false);
    await unclaimEvent(sql, "evt_1");
    expect(await claimEvent(sql, "evt_1")).toBe(true);
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push(await hitRateLimit(sql, "k", 3, 60));
    expect(hits).toEqual([true, true, true, false]);
  });
});
