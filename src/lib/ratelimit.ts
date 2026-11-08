import "server-only";
import { headers } from "next/headers";
import { withDb } from "@/lib/db";
import { hitRateLimit } from "@/lib/money-db";

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** Postgres-backed fixed-window limiter, per IP and (if signed in) per user. Throws a friendly Error when exceeded. */
export async function rateLimit(action: string, opts: { limit: number; windowSeconds: number; userId?: string | null }) {
  const keys = [`${action}:ip:${await clientIp()}`];
  if (opts.userId) keys.push(`${action}:user:${opts.userId}`);
  await withDb(async (sql) => {
    for (const key of keys) if (!(await hitRateLimit(sql, key, opts.limit, opts.windowSeconds))) throw new RateLimitError();
  });
}

export class RateLimitError extends Error {
  constructor() { super("Too many requests. Please wait a minute and try again."); this.name = "RateLimitError"; }
}
