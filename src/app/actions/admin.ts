"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { fail, requireAdmin, UserError, type Result } from "@/lib/auth";
import { emailGiversPaid, emailRequester } from "@/lib/email";
import { payProvider } from "@/lib/payout";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { payoutInput, rejectInput } from "@/lib/validation";
import { z } from "zod";

const COLS = "id,requester_id,status_token,biller_name,amount_cents,first_name,reject_reason,payment_confirmation";
const idOnly = z.object({ billId: z.string().uuid() });

export async function approveBill(billId: string): Promise<Result> {
  try {
    await requireAdmin();
    const id = idOnly.parse({ billId }).billId;
    const { data, error } = await supabaseAdmin().from("bills").update({ status: "live" }).eq("id", id).eq("status", "pending_review").select(COLS).single();
    if (error || !data) throw new UserError("That bill is no longer pending.");
    await emailRequester("live", data);
    revalidatePath("/"); revalidatePath("/admin/review");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function rejectBill(input: unknown): Promise<Result> {
  try {
    await requireAdmin();
    const r = rejectInput.safeParse(input);
    if (!r.success) throw new UserError("A reason is required.");
    const { data, error } = await supabaseAdmin().from("bills").update({ status: "rejected", reject_reason: r.data.reason }).eq("id", r.data.billId).eq("status", "pending_review").select(COLS).single();
    if (error || !data) throw new UserError("That bill is no longer pending.");
    await emailRequester("rejected", data);
    revalidatePath("/admin/review");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function startPaying(billId: string): Promise<Result> {
  try {
    await requireAdmin();
    const id = idOnly.parse({ billId }).billId;
    const { error, data } = await supabaseAdmin().from("bills").update({ status: "paying" }).eq("id", id).eq("status", "funded").select("id").single();
    if (error || !data) throw new UserError("Someone else already picked this one up.");
    revalidatePath("/admin/payouts");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Admin paid the biller outside the app: record the confirmation (+ optional proof) and close the loop by email. */
export async function markPaid(form: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const p = payoutInput.safeParse({ billId: form.get("billId"), confirmation: form.get("confirmation") });
    if (!p.success) throw new UserError("Enter the biller's confirmation number.");
    const sb = supabaseAdmin();
    const { data: bill } = await sb.from("bills").select("id,status,biller_name,account_last4,amount_cents").eq("id", p.data.billId).single();
    if (!bill || !["funded", "paying"].includes(bill.status)) throw new UserError("This bill isn't waiting for payout.");

    let proofPath: string | undefined;
    const proof = form.get("proof");
    if (proof instanceof File && proof.size > 0) {
      if (proof.size > 8 * 1024 * 1024) throw new UserError("Proof file is over 8 MB.");
      proofPath = `proofs/${bill.id}-${randomUUID()}`;
      const { error } = await sb.storage.from("bills").upload(proofPath, Buffer.from(await proof.arrayBuffer()), { contentType: proof.type || "application/octet-stream" });
      if (error) throw error;
    }

    const res = await payProvider().settle({ billId: bill.id, billerName: bill.biller_name, accountLast4: bill.account_last4, amountCents: bill.amount_cents, confirmation: p.data.confirmation, proofPath });
    const { data: paid, error } = await sb.from("bills").update({
      status: "paid", payment_confirmation: res.confirmation, payment_proof_path: res.proofPath ?? null, paid_at: new Date().toISOString(),
    }).eq("id", bill.id).in("status", ["funded", "paying"]).select(COLS).single();
    if (error || !paid) throw new UserError("Couldn't mark this paid.");

    await emailRequester("paid", paid);
    await emailGiversPaid(paid.id, paid.biller_name, res.confirmation);
    revalidatePath("/admin/payouts");
    return { ok: true };
  } catch (e) { console.error("markPaid", e); return fail(e); }
}
