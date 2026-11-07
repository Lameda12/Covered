import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const root = path.resolve(__dirname, "../..");

export function makePool(max = 20) {
  return new pg.Pool({ connectionString: TEST_DB_URL, max });
}

/** Drop everything and re-apply the Supabase stub + all migrations. */
export async function resetDb(pool: pg.Pool) {
  await pool.query("drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists storage cascade; create schema public;");
  await pool.query(readFileSync(path.join(root, "tests/sql/supabase_stub.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await pool.query(readFileSync(path.join(dir, f), "utf8"));
}

export async function createUser(pool: pg.Pool, email: string): Promise<string> {
  const { rows } = await pool.query("insert into auth.users (email) values ($1) returning id", [email]);
  return rows[0].id;
}

export async function createBill(pool: pg.Pool, requesterId: string, o: Partial<{
  amount: number; funded: number; status: string; category: string; city: string; due: string; biller: string;
}> = {}): Promise<string> {
  const { rows } = await pool.query(
    `insert into public.bills (requester_id, status, category, biller_name, account_last4, amount_cents, funded_cents, due_date, city, first_name, image_path)
     values ($1,$2,$3,$4,'2291',$5,$6, coalesce($7::date, current_date + 5), $8,'Tanya','secret/path.jpg') returning id`,
    [requesterId, o.status ?? "live", o.category ?? "electric", o.biller ?? "Metro Electric", o.amount ?? 10000, o.funded ?? 0, o.due ?? null, o.city ?? "Detroit"],
  );
  return rows[0].id;
}

/** Run fn in a transaction as the given role/user (RLS applies). */
export async function asRole<T>(pool: pg.Pool, role: "anon" | "authenticated" | "service_role", userId: string | null, fn: (q: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [userId ?? "", role]);
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
}
