import { revalidatePath } from "next/cache";
import type Stripe from "stripe";
import { emailGiverReceipt, emailRequester } from "@/lib/email";
import { stripe } from "@/lib/stripe";
import { withDb } from "@/lib/db";
import type { Sql } from "@/lib/db-core";
import { allocateSweep, applyContribution, claimEvent, recordRefund, recordSweepRefund, unclaimEvent } from "@/lib/money-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    if (!sig) throw new Error("missing signature");
    // Async variant: uses WebCrypto, which is what Workers provide.
    event = await stripe().webhooks.constructEventAsync(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  return withDb(async (sql) => {
    // Idempotency: claim the event id first. A duplicate delivery inserts nothing and is skipped.
    if (!(await claimEvent(sql, event.id))) return new Response("duplicate", { status: 200 });
    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status === "paid") {
          if (session.metadata?.kind === "sweep") await handleSweep(sql, session);
          else if (session.metadata?.kind === "contribution") await handleContribution(sql, session);
        }
      }
      // charge.refunded: refunds we issue are recorded at the call site (recordRefund / recordSweepRefund).
      // TODO(v2): reconcile refunds issued manually from the Stripe dashboard.
    } catch (e) {
      console.error("webhook failed", event.id, e);
      await unclaimEvent(sql, event.id); // un-claim so Stripe's retry reprocesses it
      return new Response("handler error", { status: 500 });
    }
    revalidatePath("/");
    return new Response("ok", { status: 200 });
  });
}

const piId = (s: Stripe.Checkout.Session) => (typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent!.id);
const refund = (pi: string, amount: number, key: string) =>
  stripe().refunds.create({ payment_intent: pi, amount, metadata: { reason: "covered_excess" } }, { idempotencyKey: key });

type BillMail = { id: string; requester_id: string; status_token: string; biller_name: string; amount_cents: number; first_name: string; city: string; category: string };

async function handleContribution(sql: Sql, s: Stripe.Checkout.Session) {
  const m = s.metadata!;
  const pi = piId(s);
  const email = (s.customer_details?.email ?? s.customer_email)?.toLowerCase() ?? null;
  const amount = parseInt(m.amount_cents, 10);
  const fee = parseInt(m.fee_cents || "0", 10);

  const r = await applyContribution(sql, { billId: m.bill_id, cents: amount, email, giverId: m.giver_id || null, paymentIntent: pi, feeCents: fee });

  // Race loser (or bill expired meanwhile): refund the excess automatically. If nothing applied, refund the fee too.
  let refunded = 0;
  if (r.excess_cents > 0) {
    refunded = r.excess_cents + (r.applied_cents === 0 ? fee : 0);
    await refund(pi, refunded, `excess-${s.id}`);
    await recordRefund(sql, r.contribution_id, refunded);
  }
  if (r.duplicate) return;

  const [bill] = await sql<BillMail[]>`select id,requester_id,status_token,biller_name,amount_cents,first_name,city,category from bills where id = ${m.bill_id}::uuid`;
  if (email && bill) {
    await emailGiverReceipt(email, r.applied_cents > 0 ? [{ biller: bill.biller_name, city: bill.city, category: bill.category, cents: r.applied_cents }] : [],
      { kind: amount >= bill.amount_cents ? "cover" : "chip", refundedCents: refunded });
  }
  if (bill && r.bill_funded && r.applied_cents > 0) await emailRequester("funded", bill);
}

async function handleSweep(sql: Sql, s: Stripe.Checkout.Session) {
  const pi = piId(s);
  const sweepId = s.metadata!.sweep_id;
  const email = (s.customer_details?.email ?? s.customer_email)?.toLowerCase() ?? null;
  await sql`update sweeps set giver_email = ${email}, stripe_payment_intent = ${pi} where id = ${sweepId}::uuid`;

  const [before] = await sql<{ status: string; budget_cents: number }[]>`select status, budget_cents from sweeps where id = ${sweepId}::uuid`;
  if (!before) throw new Error("sweep missing");
  const firstRun = before.status === "awaiting_payment";

  const rows = await allocateSweep(sql, sweepId, pi);
  const spent = rows.reduce((t, r) => t + r.applied_cents, 0);
  const leftover = before.budget_cents - spent;

  if (firstRun) {
    if (leftover > 0) await refund(pi, leftover, `sweep-left-${sweepId}`);
    await recordSweepRefund(sql, sweepId, leftover);
    if (email) await emailGiverReceipt(email, rows.map((r) => ({ biller: r.biller_name, city: r.city, category: r.category, cents: r.applied_cents })), { kind: "sweep", refundedCents: leftover });
    if (rows.length) {
      const bills = await sql<BillMail[]>`select id,requester_id,status_token,biller_name,amount_cents,first_name,city,category from bills where id = any(${rows.map((r) => r.bill_id)}::uuid[])`;
      for (const b of bills) await emailRequester("funded", b);
    }
  }
}
