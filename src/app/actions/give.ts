"use server";

import { cardFeeCents } from "@/lib/money";
import { siteUrl } from "@/lib/env";
import { fail, UserError, type Result } from "@/lib/auth";
import { withDb } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { stripe } from "@/lib/stripe";
import { currentUser } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { checkoutInput } from "@/lib/validation";

type BillRow = { id: string; status: string; amount_cents: number; funded_cents: number; biller_name: string; first_name: string; city: string };

/** Cover or chip in: re-reads the bill, caps the amount at what's still owed, returns a Stripe Checkout URL. */
export async function createCheckout(input: unknown, turnstileToken?: string | null): Promise<Result<{ url: string }>> {
  try {
    const parsed = checkoutInput.safeParse(input);
    if (!parsed.success) throw new UserError("That amount isn't valid.");
    const { billId, mode, amountCents, coverFee } = parsed.data;
    await verifyTurnstile(turnstileToken);
    const user = await currentUser();
    await rateLimit("checkout", { limit: 12, windowSeconds: 600, userId: user?.id });

    const [bill] = await withDb((sql) => sql<BillRow[]>`select id,status,amount_cents,funded_cents,biller_name,first_name,city from bills where id = ${billId}::uuid`);
    if (!bill || bill.status !== "live") throw new UserError("This bill was just covered. Pick another one.");
    const remaining = bill.amount_cents - bill.funded_cents;
    if (remaining <= 0) throw new UserError("This bill was just covered. Pick another one.");

    const amount = mode === "cover" ? remaining : Math.min(amountCents ?? 2500, remaining);
    const fee = coverFee ? cardFeeCents(amount) : 0;
    const metadata = {
      kind: "contribution", bill_id: bill.id, amount_cents: String(amount), fee_cents: String(fee), giver_id: user?.id ?? "",
    };
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        { quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: { name: `${mode === "cover" ? "Cover" : "Chip in on"} ${bill.first_name}'s ${bill.biller_name} bill`, description: `Paid directly to ${bill.biller_name}. ${bill.city}.` } } },
        ...(fee ? [{ quantity: 1, price_data: { currency: "usd", unit_amount: fee, product_data: { name: "Card fee, so the full amount reaches the bill" } } }] : []),
      ],
      customer_email: user?.email ?? undefined,
      metadata,
      payment_intent_data: { metadata, description: `Covered: ${bill.biller_name} (${bill.id})` },
      success_url: `${siteUrl()}/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/`,
    });
    if (!session.url) throw new Error("no checkout url");
    return { ok: true, url: session.url };
  } catch (e) {
    console.error("createCheckout", e);
    return fail(e, "We couldn't start checkout. Please try again.");
  }
}

export type SessionState =
  | { state: "pending" }
  | { state: "done"; kind: "contribution"; appliedCents: number; refundedCents: number; billFunded: boolean; biller: string; pct: number }
  | { state: "done"; kind: "sweep"; appliedCents: number; refundedCents: number; bills: number };

/** Polled by /thanks until the webhook has processed the payment. Only reveals data for the caller's own session id. */
export async function checkSession(sessionId: string): Promise<SessionState> {
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId)) return { state: "pending" };
  const s = await stripe().checkout.sessions.retrieve(sessionId);
  if (s.payment_status !== "paid") return { state: "pending" };
  const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
  if (!pi) return { state: "pending" };
  return withDb(async (sql): Promise<SessionState> => {
    if (s.metadata?.kind === "sweep") {
      const [sw] = await sql<{ allocated_cents: number; refunded_cents: number; status: string }[]>`select allocated_cents, refunded_cents, status from sweeps where stripe_session_id = ${s.id}`;
      if (!sw || sw.status !== "complete") return { state: "pending" };
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from contributions where stripe_payment_intent = ${pi}`;
      return { state: "done", kind: "sweep", appliedCents: sw.allocated_cents, refundedCents: sw.refunded_cents, bills: n };
    }
    const billId = s.metadata?.bill_id;
    if (!billId) return { state: "pending" };
    const [c] = await sql<{ amount_cents: number; refunded_cents: number }[]>`select amount_cents, refunded_cents from contributions where stripe_payment_intent = ${pi} and bill_id = ${billId}::uuid`;
    if (!c) return { state: "pending" };
    const [bill] = await sql<{ amount_cents: number; funded_cents: number; biller_name: string }[]>`select amount_cents, funded_cents, biller_name from bills where id = ${billId}::uuid`;
    return {
      state: "done", kind: "contribution", appliedCents: c.amount_cents, refundedCents: c.refunded_cents,
      billFunded: !!bill && bill.funded_cents >= bill.amount_cents, biller: bill?.biller_name ?? "",
      pct: bill ? Math.round((bill.funded_cents / bill.amount_cents) * 100) : 0,
    };
  });
}
