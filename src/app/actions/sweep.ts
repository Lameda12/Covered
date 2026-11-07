"use server";

import { siteUrl } from "@/lib/env";
import { fail, UserError, type Result } from "@/lib/auth";
import { parseSweepWithClaude } from "@/lib/anthropic";
import { rateLimit } from "@/lib/ratelimit";
import { planSweep, parseSweepHeuristic, type PlanBill } from "@/lib/sweep";
import { stripe } from "@/lib/stripe";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin, supabaseAnon } from "@/lib/supabase/admin";
import { dollars } from "@/lib/money";
import { sweepFilters, sweepText, type SweepFilters } from "@/lib/validation";

async function liveBills(): Promise<PlanBill[]> {
  const { data, error } = await supabaseAnon().from("public_bills")
    .select("id,category,city,biller_name,due_date,amount_cents,funded_cents").limit(5000);
  if (error) throw error;
  return data ?? [];
}

/** "heat bills in Winnipeg under $400, due this week, $10k" -> editable filters. */
export async function parseSweep(text: string): Promise<Result<{ filters: SweepFilters; usedAi: boolean }>> {
  try {
    const t = sweepText.safeParse(text);
    if (!t.success) throw new UserError("Describe the bills you want to cover, e.g. “heat bills in Winnipeg under $400, due this week, $10k”.");
    const user = await currentUser();
    await rateLimit("sweep-parse", { limit: 20, windowSeconds: 600, userId: user?.id });
    const cities = [...new Set((await liveBills()).map((b) => b.city))];
    const ai = await parseSweepWithClaude(t.data, cities);
    return { ok: true, filters: ai ?? parseSweepHeuristic(t.data, cities), usedAi: !!ai };
  } catch (e) {
    return fail(e, "Couldn't read that. Try the chips below instead.");
  }
}

export async function previewSweep(filters: unknown) {
  const f = sweepFilters.safeParse(filters);
  if (!f.success) return { ok: false as const, error: "Check the budget and filters." };
  try {
    const p = planSweep(await liveBills(), f.data);
    return {
      ok: true as const, matching: p.matching, owed: p.owed, bills: p.take.length, spend: p.spend, leftover: p.leftover,
      byCategory: p.byCategory, households: p.households,
    };
  } catch (e) {
    return fail(e, "Couldn't load the preview.");
  }
}

/** Charge the whole budget in one Checkout. The webhook runs allocate_sweep and refunds what's left. */
export async function startSweepCheckout(filters: unknown): Promise<Result<{ url: string }>> {
  try {
    const f = sweepFilters.safeParse(filters);
    if (!f.success) throw new UserError("Check the budget and filters.");
    const user = await currentUser();
    await rateLimit("sweep-checkout", { limit: 6, windowSeconds: 600, userId: user?.id });
    const plan = planSweep(await liveBills(), f.data);
    if (!plan.take.length) throw new UserError("Nothing matches these rules right now.");

    const sb = supabaseAdmin();
    const { data: sweep, error } = await sb.from("sweeps").insert({
      giver_id: user?.id ?? null, giver_email: user?.email ?? null, filters: f.data, budget_cents: f.data.budget_cents,
    }).select("id").single();
    if (error || !sweep) throw error ?? new Error("sweep insert failed");

    const metadata = { kind: "sweep", sweep_id: sweep.id, giver_id: user?.id ?? "" };
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: f.data.budget_cents, product_data: {
        name: `Covered sweep, budget ${dollars(f.data.budget_cents, 0)}`,
        description: "Pays matching bills directly to their billers, most urgent first. Anything unspent is refunded.",
      } } }],
      customer_email: user?.email ?? undefined,
      metadata,
      payment_intent_data: { metadata, description: `Covered sweep ${sweep.id}` },
      success_url: `${siteUrl()}/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/sweep`,
    });
    await sb.from("sweeps").update({ stripe_session_id: session.id }).eq("id", sweep.id);
    if (!session.url) throw new Error("no checkout url");
    return { ok: true, url: session.url };
  } catch (e) {
    console.error("startSweepCheckout", e);
    return fail(e, "We couldn't start checkout. Please try again.");
  }
}
