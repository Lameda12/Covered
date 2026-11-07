import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createBill, createUser, makePool, resetDb, TEST_DB_URL } from "./helpers/db";

const d = TEST_DB_URL ? describe : describe.skip;
const pool = makePool();

d("row level security", () => {
  let alice: string, bob: string, admin: string, liveBill: string, bobBill: string, pendingBill: string;
  beforeAll(async () => {
    await resetDb(pool);
    alice = await createUser(pool, "alice@x.com");
    bob = await createUser(pool, "bob@x.com");
    admin = await createUser(pool, "admin@x.com");
    await pool.query("update profiles set role='admin' where id=$1", [admin]);
    liveBill = await createBill(pool, alice, { status: "live" });
    pendingBill = await createBill(pool, bob, { status: "pending_review" });
    bobBill = pendingBill;
    await pool.query("insert into contributions (bill_id, giver_email, amount_cents, requested_cents, stripe_payment_intent) values ($1,'someone@x.com',500,500,'pi_x')", [liveBill]);
  });
  afterAll(async () => { await pool.end(); });

  it("anon cannot read the bills table at all", async () => {
    await asRole(pool, "anon", null, async (c) => {
      await expect(c.query("select * from bills")).rejects.toThrow(/permission denied/);
    });
  });

  it("anon sees live bills through public_bills, without image_path, requester or token", async () => {
    await asRole(pool, "anon", null, async (c) => {
      const { rows, fields } = await c.query("select * from public_bills");
      expect(rows.map((r) => r.id)).toEqual([liveBill]); // pending bill is hidden
      const cols = fields.map((f) => f.name);
      for (const secret of ["image_path", "requester_id", "status_token", "payment_confirmation", "reject_reason"]) expect(cols).not.toContain(secret);
      await expect(c.query("select image_path from public_bills")).rejects.toThrow(/column .* does not exist/);
    });
  });

  it("anon cannot read contributions, sweeps, profiles (no emails), thank-yous or write anything", async () => {
    for (const t of ["contributions", "sweeps", "profiles", "thank_yous", "stripe_events", "rate_limits"]) {
      await asRole(pool, "anon", null, async (c) => {
        await expect(c.query(`select * from ${t}`)).rejects.toThrow(/permission denied/);
      });
    }
    await asRole(pool, "anon", null, async (c) => {
      await expect(c.query("insert into contributions (bill_id, amount_cents, requested_cents) values ($1,1,1)", [liveBill])).rejects.toThrow(/permission denied/);
    });
  });

  it("a signed-in user sees only their own bill rows; others' images stay hidden", async () => {
    await asRole(pool, "authenticated", alice, async (c) => {
      const { rows } = await c.query("select id, image_path from bills");
      expect(rows.map((r) => r.id)).toEqual([liveBill]);
      expect(rows.map((r) => r.id)).not.toContain(bobBill);
    });
    await asRole(pool, "authenticated", bob, async (c) => {
      const { rows } = await c.query("select id from bills");
      expect(rows.map((r) => r.id)).toEqual([bobBill]);
    });
  });

  it("a signed-in user cannot insert contributions, modify bills, or make themselves admin", async () => {
    await asRole(pool, "authenticated", alice, async (c) => {
      await expect(c.query("insert into contributions (bill_id, amount_cents, requested_cents) values ($1,1,1)", [liveBill])).rejects.toThrow();
    });
    await asRole(pool, "authenticated", alice, async (c) => {
      const r = await c.query("update bills set funded_cents = amount_cents where id=$1", [liveBill]);
      expect(r.rowCount).toBe(0); // RLS filters the row out of the update
    });
    await asRole(pool, "authenticated", alice, async (c) => {
      await expect(c.query("update profiles set role='admin' where id=$1", [alice])).rejects.toThrow(/role cannot be changed/);
    });
  });

  it("users cannot read other users' profiles or contributions", async () => {
    await asRole(pool, "authenticated", bob, async (c) => {
      expect((await c.query("select id from profiles")).rows.map((r) => r.id)).toEqual([bob]);
      expect((await c.query("select * from contributions")).rowCount).toBe(0);
    });
  });

  it("admins can read every bill; the app functions are service-role only", async () => {
    await asRole(pool, "authenticated", admin, async (c) => {
      expect((await c.query("select id from bills")).rowCount).toBe(2);
    });
    await asRole(pool, "authenticated", alice, async (c) => {
      await expect(c.query("select * from apply_contribution($1,100,'x@x.com',null,'pi_hack',0,null)", [liveBill])).rejects.toThrow(/permission denied/);
    });
    await asRole(pool, "anon", null, async (c) => {
      await expect(c.query("select * from hit_rate_limit('k',1,60)")).rejects.toThrow(/permission denied/);
    });
  });

  it("bill images: only the owner and admins can read them", async () => {
    await pool.query("insert into storage.objects (bucket_id, name) values ('bills', $1 || '/a.jpg')", [alice]);
    await asRole(pool, "anon", null, async (c) => { await expect(c.query("select * from storage.objects")).rejects.toThrow(); });
    await asRole(pool, "authenticated", alice, async (c) => { expect((await c.query("select * from storage.objects")).rowCount).toBe(1); });
    await asRole(pool, "authenticated", bob, async (c) => { expect((await c.query("select * from storage.objects")).rowCount).toBe(0); });
    await asRole(pool, "authenticated", admin, async (c) => { expect((await c.query("select * from storage.objects")).rowCount).toBe(1); });
  });
});
