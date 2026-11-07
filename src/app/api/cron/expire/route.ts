import { emailRequester } from "@/lib/email";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daily (see vercel.json): expire bills 7 days past due and refund whatever was contributed to them. */
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("unauthorized", { status: 401 });
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("expire_bills");
  if (error) return new Response(error.message, { status: 500 });

  let refunded = 0, failed = 0;
  for (const c of (data ?? []) as { contribution_id: string; payment_intent: string; refundable_cents: number }[]) {
    try {
      await stripe().refunds.create(
        { payment_intent: c.payment_intent, amount: c.refundable_cents, metadata: { reason: "bill_expired" } },
        { idempotencyKey: `expire-${c.contribution_id}-${c.refundable_cents}` },
      );
      await sb.rpc("record_refund", { p_contribution_id: c.contribution_id, p_refunded_cents: c.refundable_cents });
      refunded++;
    } catch (e) {
      failed++;
      console.error("expire refund failed", c.contribution_id, e);
    }
  }
  return Response.json({ expiredBills: new Set((data ?? []).map((d: { bill_id: string }) => d.bill_id)).size, refunded, failed });
}
