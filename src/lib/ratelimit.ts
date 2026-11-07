import "server-only";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** Postgres-backed fixed-window limiter, per IP and (if signed in) per user. Throws a friendly Error when exceeded. */
export async function rateLimit(action: string, opts: { limit: number; windowSeconds: number; userId?: string | null }) {
  const sb = supabaseAdmin();
  const keys = [`${action}:ip:${await clientIp()}`];
  if (opts.userId) keys.push(`${action}:user:${opts.userId}`);
  for (const key of keys) {
    const { data, error } = await sb.rpc("hit_rate_limit", { p_key: key, p_limit: opts.limit, p_window_seconds: opts.windowSeconds });
    if (error) throw error;
    if (data === false) throw new RateLimitError();
  }
}

export class RateLimitError extends Error {
  constructor() { super("Too many requests. Please wait a minute and try again."); this.name = "RateLimitError"; }
}
