import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBill, createUser, makePool, resetDb, TEST_DB_URL } from "./helpers/db";

const d = TEST_DB_URL ? describe : describe.skip;
const pool = makePool();

d("allocate_sweep", () => {
  beforeAll(async () => { await resetDb(pool); });
  afterAll(async () => { await pool.end(); });

  async function sweep(budget: number, filters: object) {
    const { rows } = await pool.query("insert into sweeps (giver_email, filters, budget_cents) values ('big@giver.com',$1,$2) returning id", [JSON.stringify(filters), budget]);
    return rows[0].id as string;
  }

  it("fills bills by due date within budget, honours filters, leaves the rest", async () => {
    const mk = async (i: number, o: Parameters<typeof createBill>[2]) => createBill(pool, await createUser(pool, `u${i}@x.com`), o);
    const urgent = await mk(1, { category: "heat", city: "Winnipeg", amount: 30000, due: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) });
    const later = await mk(2, { category: "heat", city: "Winnipeg", amount: 25000, due: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) });
    const tooBig = await mk(3, { category: "heat", city: "Winnipeg", amount: 90000, due: new Date(Date.now() + 1 * 864e5).toISOString().slice(0, 10) });
    const wrongCity = await mk(4, { category: "heat", city: "Detroit", amount: 10000 });
    const wrongCat = await mk(5, { category: "rent", city: "Winnipeg", amount: 10000 });
    const tooLate = await mk(6, { category: "heat", city: "Winnipeg", amount: 10000, due: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) });

    // budget $500: urgent (300) fits, later (250) does not fit in the remaining 200
    const id = await sweep(50000, { categories: ["heat"], cities: ["Winnipeg"], max_bill_cents: 40000, due_within_days: 7 });
    const { rows } = await pool.query("select * from allocate_sweep($1,'pi_sweep')", [id]);
    expect(rows.map((r) => r.bill_id)).toEqual([urgent]);
    const s = (await pool.query("select * from sweeps where id=$1", [id])).rows[0];
    expect(s.allocated_cents).toBe(30000);
    expect(s.status).toBe("allocated");

    const st = async (bid: string) => (await pool.query("select status from bills where id=$1", [bid])).rows[0].status;
    expect(await st(urgent)).toBe("funded");
    for (const b of [later, tooBig, wrongCity, wrongCat, tooLate]) expect(await st(b)).toBe("live");

    // re-running is a no-op (webhook retry)
    await pool.query("select * from allocate_sweep($1,'pi_sweep')", [id]);
    expect((await pool.query("select count(*)::int c from contributions where sweep_id=$1", [id])).rows[0].c).toBe(1);

    // a bigger second sweep picks up the leftovers within its filters: later fits now
    const id2 = await sweep(50000, { categories: ["heat"], cities: ["Winnipeg"], max_bill_cents: 40000, due_within_days: 7 });
    const r2 = await pool.query("select * from allocate_sweep($1,'pi_sweep2')", [id2]);
    expect(r2.rows.map((r) => r.bill_id)).toEqual([later]);
  });

  it("a $10k sweep over 40 bills allocates at most the budget and the leftover is budget - allocated", async () => {
    await pool.query("delete from contributions; delete from sweeps; delete from bills; delete from auth.users;");
    for (let i = 0; i < 40; i++) {
      const u = await createUser(pool, `m${i}@x.com`);
      await createBill(pool, u, { amount: 15000 + i * 700, category: "electric", due: new Date(Date.now() + (1 + (i % 6)) * 864e5).toISOString().slice(0, 10) });
    }
    const id = await sweep(1_000_000, { categories: ["electric"], max_bill_cents: 40000, due_within_days: 7 });
    const { rows } = await pool.query("select * from allocate_sweep($1,'pi_big')", [id]);
    const total = rows.reduce((s, r) => s + r.applied_cents, 0);
    expect(total).toBeLessThanOrEqual(1_000_000);
    expect(total).toBeGreaterThan(900_000);
    const s = (await pool.query("select allocated_cents from sweeps where id=$1", [id])).rows[0];
    expect(s.allocated_cents).toBe(total);
    const over = await pool.query("select count(*)::int c from bills where funded_cents > amount_cents");
    expect(over.rows[0].c).toBe(0);
  });

  it("concurrent sweeps never double-fill a bill", async () => {
    await pool.query("delete from contributions; delete from sweeps; delete from bills; delete from auth.users;");
    for (let i = 0; i < 10; i++) await createBill(pool, await createUser(pool, `c${i}@x.com`), { amount: 10000, category: "water" });
    const ids = await Promise.all([sweep(1_000_000, { categories: ["water"] }), sweep(1_000_000, { categories: ["water"] }), sweep(1_000_000, { categories: ["water"] })]);
    const res = await Promise.all(ids.map((id, i) => pool.query("select * from allocate_sweep($1,$2)", [id, `pi_c${i}`])));
    expect(res.reduce((s, r) => s + r.rowCount!, 0)).toBe(10);
    expect((await pool.query("select count(*)::int c from contributions")).rows[0].c).toBe(10);
  });
});
