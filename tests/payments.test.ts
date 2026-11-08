import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBill, createUser, makePool, resetDb, TEST_DB_URL } from "./helpers/db";

const d = TEST_DB_URL ? describe : describe.skip;
const pool = makePool();

const apply = (billId: string, cents: number, pi: string, email = "g@x.com") =>
  pool.query("select * from apply_contribution($1,$2,$3,null,$4,0,null)", [billId, cents, email, pi]).then((r) => r.rows[0]);

d("apply_contribution", () => {
  let requester: string;
  beforeAll(async () => { await resetDb(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query("delete from contributions; delete from bills; delete from auth.users;");
    requester = await createUser(pool, "tanya@x.com");
  });

  it("covers a bill and flips it to funded", async () => {
    const b = await createBill(pool, requester, { amount: 28640 });
    const r = await apply(b, 28640, "pi_1");
    expect(r.applied_cents).toBe(28640);
    expect(r.excess_cents).toBe(0);
    expect(r.bill_funded).toBe(true);
    const { rows } = await pool.query("select status, funded_cents from bills where id=$1", [b]);
    expect(rows[0]).toMatchObject({ status: "funded", funded_cents: 28640 });
  });

  it("two simultaneous full covers never overfund; the loser gets everything back", async () => {
    const b = await createBill(pool, requester, { amount: 20000 });
    const results = await Promise.all([apply(b, 20000, "pi_a", "a@x.com"), apply(b, 20000, "pi_b", "b@x.com")]);
    const applied = results.map((r) => r.applied_cents).sort((x, y) => x - y);
    const excess = results.map((r) => r.excess_cents).sort((x, y) => x - y);
    expect(applied).toEqual([0, 20000]);
    expect(excess).toEqual([0, 20000]);
    const { rows } = await pool.query("select status, funded_cents from bills where id=$1", [b]);
    expect(rows[0]).toMatchObject({ status: "funded", funded_cents: 20000 });
    const c = await pool.query("select coalesce(sum(amount_cents),0)::int s from contributions where bill_id=$1", [b]);
    expect(c.rows[0].s).toBe(20000);
  });

  it("partial overlap: 7000 + 7000 on a 10000 bill applies 10000 and refunds 4000", async () => {
    const b = await createBill(pool, requester, { amount: 10000 });
    const results = await Promise.all([apply(b, 7000, "pi_a"), apply(b, 7000, "pi_b")]);
    expect(results.reduce((s, r) => s + r.applied_cents, 0)).toBe(10000);
    expect(results.reduce((s, r) => s + r.excess_cents, 0)).toBe(4000);
  });

  it("40 concurrent $25 chips on a $500 bill: exactly 20 land", async () => {
    const b = await createBill(pool, requester, { amount: 50000 });
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => apply(b, 2500, `pi_${i}`, `g${i}@x.com`)));
    expect(results.reduce((s, r) => s + r.applied_cents, 0)).toBe(50000);
    expect(results.filter((r) => r.excess_cents === 2500)).toHaveLength(20);
    const { rows } = await pool.query("select funded_cents, status from bills where id=$1", [b]);
    expect(rows[0]).toEqual({ funded_cents: 50000, status: "funded" });
  });

  it("is idempotent per payment intent (webhook retries)", async () => {
    const b = await createBill(pool, requester, { amount: 10000 });
    await apply(b, 2500, "pi_dup");
    const again = await apply(b, 2500, "pi_dup");
    expect(again.duplicate).toBe(true);
    const { rows } = await pool.query("select funded_cents from bills where id=$1", [b]);
    expect(rows[0].funded_cents).toBe(2500);
  });

  it("refunds everything when the bill is no longer live", async () => {
    const b = await createBill(pool, requester, { amount: 10000, status: "expired" });
    const r = await apply(b, 2500, "pi_late");
    expect(r.applied_cents).toBe(0);
    expect(r.excess_cents).toBe(2500);
  });

  it("SQL enforces funded <= amount and one open bill per requester", async () => {
    const b = await createBill(pool, requester, { amount: 10000 });
    await expect(pool.query("update bills set funded_cents = 10001 where id=$1", [b])).rejects.toThrow(/funded_within_amount/);
    await expect(createBill(pool, requester)).rejects.toThrow(/one_open_bill_per_requester/);
    await pool.query("update bills set status='paid' where id=$1", [b]);
    await expect(createBill(pool, requester)).resolves.toBeTruthy();
  });
});
