import "server-only";
import { UserError } from "@/lib/auth";
import { clientIp } from "@/lib/ratelimit";

/** Verify a Cloudflare Turnstile token server-side. Fails closed in production if the secret is missing. */
export async function verifyTurnstile(token: string | null | undefined) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new Error("TURNSTILE_SECRET_KEY not configured");
    return; // local dev without keys
  }
  if (!token) throw new UserError("Verification didn't finish. Wait a second and try again.");
  const body = new URLSearchParams({ secret, response: token, remoteip: await clientIp(), idempotency_key: crypto.randomUUID() });
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const out = (await res.json()) as { success?: boolean };
  if (!out.success) throw new UserError("Verification failed. Please try again.");
}
