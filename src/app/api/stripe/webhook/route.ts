import { revalidatePath } from "next/cache";
import type Stripe from "stripe";
import { emailGiverReceipt, emailRequester } from "@/lib/email";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Admin = ReturnType<typeof supabaseAdmin>;

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    if (!sig) throw new Error("missing signature");
    event = stripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  const sb = supabaseAdmin();
  // Idempotency: claim the event id first. A duplicate delivery inserts nothing and is skipped.
  const { data: claimed, error: claimErr } = await sb.from("stripe_events").upsert({ id: event.id }, { onConflict: "id", ignoreDuplicates: true }).select("id");
  if (claimErr) return new Response("db error", { status: 500 });
  if (!claimed?.length) return new Response("duplicate", { status: 200 });

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid") {
        if (session.metadata?.kind === "sweep") await handleSweep(sb, session);
        else if (session.metadata?.kind === "contribution") await handleContribution(sb, session);
      }
    }
    // charge.refunded: refunds we issue are recorded at the call site (record_refund / record_sweep_refund).
    // TODO(v2): reconcile refunds issued manually from the Stripe dashboard.
  } catch (e) {
    console.error("webhook failed", event.id, e);
    await sb.from("stripe_events").delete().eq("id", event.id); // un-claim so Stripe's retry reprocesses it
    return new Response("handler error", { status: 500 });
  }
  revalidatePath("/");
  return new Response("ok", { status: 200 });
}

const piId = (s: Stripe.Checkout.Session) => (typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent!.id);
const refund = (pi: string, amount: number, key: string) =>
  stripe().refunds.create({ payment_intent: pi, amount, metadata: { reason: "covered_excess" } }, { idempotencyKey: key });

async function handleContribution(sb: Admin, s: Stripe.Checkout.Session) {
  const m = s.metadata!;
  const pi = piId(s);
  const email = s.customer_details?.email ?? s.customer_email ?? null;
  const amount = parseInt(m.amount_cents, 10);
  const fee = parseInt(m.fee_cents || "0", 10);

  const { data, error } = await sb.rpc("apply_contribution", {
    p_bill_id: m.bill_id, p_amount_cents: amount, p_giver_email: email, p_giver_id: m.giver_id || null,
    p_payment_intent: pi, p_fee_cents: fee, p_sweep_id: null,
  });
  if (error) throw error;
  const r = data[0] as { contribution_id: string; applied_cents: number; excess_cents: number; bill_funded: boolean; duplicate: boolean };

  // Race loser (or bill expired meanwhile): refund the excess automatically. If nothing applied, refund the fee too.
  let refunded = 0;
  if (r.excess_cents > 0) {
    refunded = r.excess_cents + (r.applied_cents === 0 ? fee : 0);
    await refund(pi, refunded, `excess-${s.id}`);
    await sb.rpc("record_refund", { p_contribution_id: r.contribution_id, p_refunded_cents: refunded });
  }
  if (r.duplicate) return;

  const { data: bill } = await sb.from("bills").select("id,requester_id,status_token,biller_name,amount_cents,first_name,city,category").eq("id", m.bill_id).single();
  if (email && bill) {
    await emailGiverReceipt(email, r.applied_cents > 0 ? [{ biller: bill.biller_name, city: bill.city, category: bill.category, cents: r.applied_cents }] : [],
      { kind: parseInt(m.amount_cents, 10) >= bill.amount_cents ? "cover" : "chip", refundedCents: refunded });
  }
  if (bill && r.bill_funded && r.applied_cents > 0) await emailRequester("funded", bill);
}

async function handleSweep(sb: Admin, s: Stripe.Checkout.Session) {
  const pi = piId(s);
  const sweepId = s.metadata!.sweep_id;
  const email = s.customer_details?.email ?? s.customer_email ?? null;
  await sb.from("sweeps").update({ giver_email: email, stripe_payment_intent: pi }).eq("id", sweepId);

  const { data: before } = await sb.from("sweeps").select("status,budget_cents").eq("id", sweepId).single();
  if (!before) throw new Error("sweep missing");
  const firstRun = before.status === "awaiting_payment";

  const { data, error } = await sb.rpc("allocate_sweep", { p_sweep_id: sweepId, p_payment_intent: pi });
  if (error) throw error;
  const rows = data as { bill_id: string; applied_cents: number; biller_name: string; city: string; category: string }[];
  const spent = rows.reduce((t, r) => t + r.applied_cents, 0);
  const leftover = before.budget_cents - spent;

  if (firstRun) {
    if (leftover > 0) await refund(pi, leftover, `sweep-left-${sweepId}`);
    await sb.rpc("record_sweep_refund", { p_sweep_id: sweepId, p_refunded_cents: leftover });
    if (email) await emailGiverReceipt(email, rows.map((r) => ({ biller: r.biller_name, city: r.city, category: r.category, cents: r.applied_cents })), { kind: "sweep", refundedCents: leftover });
    const { data: bills } = await sb.from("bills").select("id,requester_id,status_token,biller_name,amount_cents,first_name").in("id", rows.map((r) => r.bill_id));
    for (const b of bills ?? []) await emailRequester("funded", b);
  }
}
