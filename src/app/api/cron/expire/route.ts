import { withDb } from "@/lib/db";
import { expireBills, recordRefund } from "@/lib/money-db";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daily via the Workers Cron Trigger in wrangler.jsonc (worker.ts calls this route with the bearer secret): expire bills 7 days past due and refund whatever was contributed to them. */
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("unauthorized", { status: 401 });
  return withDb(async (sql) => {
    const rows = await expireBills(sql);
    let refunded = 0, failed = 0;
    for (const c of rows) {
      try {
        await stripe().refunds.create(
          { payment_intent: c.payment_intent, amount: c.refundable_cents, metadata: { reason: "bill_expired" } },
          { idempotencyKey: `expire-${c.contribution_id}-${c.refundable_cents}` },
        );
        await recordRefund(sql, c.contribution_id, c.refundable_cents);
        refunded++;
      } catch (e) {
        failed++;
        console.error("expire refund failed", c.contribution_id, e);
      }
    }
    return Response.json({ expiredBills: new Set(rows.map((d) => d.bill_id)).size, refunded, failed });
  });
}
