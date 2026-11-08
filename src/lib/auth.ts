import "server-only";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { withDb } from "@/lib/db";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export const fail = (e: unknown, fallback = "Something went wrong. Please try again."): { ok: false; error: string } => ({
  ok: false, error: e instanceof Error && (e.name === "RateLimitError" || e.name === "UserError") ? e.message : fallback,
});

export class UserError extends Error { constructor(m: string) { super(m); this.name = "UserError"; } }

/** Server-side admin check (middleware guards the routes too, this guards the actions). */
export async function requireAdmin() {
  const user = await currentUser();
  if (!user) redirect("/receipts?next=/admin/review");
  const [row] = await withDb((sql) => sql<{ role: string }[]>`select role from profiles where id = ${user.id}::uuid`);
  if (row?.role !== "admin") throw new UserError("Admins only.");
  return user;
}
