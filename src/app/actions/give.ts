"use server";

import { cardFeeCents } from "@/lib/money";
import { siteUrl } from "@/lib/env";
import { fail, UserError, type Result } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { stripe } from "@/lib/stripe";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkoutInput } from "@/lib/validation";

/** Cover or chip in: re-reads the bill, caps the amount at what is still owed, returns a Stripe Checkout URL. */
export async function createCheckout(input: unknown): Promise<Result<{ url: string }>> {
  try {
    const parsed = checkoutInput.safeParse(input);
    if (!parsed.success) throw new UserError("That amount isn't valid.");
    const { billId, mode, amountCents, coverFee } = parsed.data;
    const user = await currentUser();
    await rateLimit("checkout", { limit: 12, windowSeconds: 600, userId: user?.id });

    const { data: bill } = await supabaseAdmin().from("bills")
      .select("id,status,amount_cents,funded_cents,biller_name,first_name,city").eq("id", billId).single();
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
  const sb = supabaseAdmin();
  const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
  if (s.metadata?.kind === "sweep") {
    const { data: sw } = await sb.from("sweeps").select("allocated_cents,refunded_cents,status").eq("stripe_session_id", s.id).single();
    if (!sw || sw.status !== "complete") return { state: "pending" };
    const { count } = await sb.from("contributions").select("id", { count: "exact", head: true }).eq("stripe_payment_intent", pi!);
    return { state: "done", kind: "sweep", appliedCents: sw.allocated_cents, refundedCents: sw.refunded_cents, bills: count ?? 0 };
  }
  const { data: c } = await sb.from("contributions").select("amount_cents,refunded_cents,bill_id").eq("stripe_payment_intent", pi!).eq("bill_id", s.metadata?.bill_id ?? "").maybeSingle();
  if (!c) return { state: "pending" };
  const { data: bill } = await sb.from("bills").select("amount_cents,funded_cents,biller_name").eq("id", c.bill_id).single();
  return {
    state: "done", kind: "contribution", appliedCents: c.amount_cents, refundedCents: c.refunded_cents,
    billFunded: !!bill && bill.funded_cents >= bill.amount_cents, biller: bill?.biller_name ?? "",
    pct: bill ? Math.round((bill.funded_cents / bill.amount_cents) * 100) : 0,
  };
}
