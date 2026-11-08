"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, requireAdmin, UserError, type Result } from "@/lib/auth";
import { withDb } from "@/lib/db";
import { emailGiversPaid, emailRequester } from "@/lib/email";
import { payProvider } from "@/lib/payout";
import { IMAGE_TYPES, MAX_UPLOAD_BYTES, newKey, putObject } from "@/lib/r2";
import { payoutInput, rejectInput } from "@/lib/validation";

type BillRow = { id: string; requester_id: string; status_token: string; biller_name: string; amount_cents: number; first_name: string; reject_reason: string | null; payment_confirmation: string | null };
const idOnly = z.object({ billId: z.string().uuid() });

export async function approveBill(billId: string): Promise<Result> {
  try {
    await requireAdmin();
    const id = idOnly.parse({ billId }).billId;
    const [bill] = await withDb((sql) => sql<BillRow[]>`update bills set status = 'live' where id = ${id}::uuid and status = 'pending_review' returning id,requester_id,status_token,biller_name,amount_cents,first_name,reject_reason,payment_confirmation`);
    if (!bill) throw new UserError("That bill is no longer pending.");
    await emailRequester("live", bill);
    revalidatePath("/"); revalidatePath("/admin/review");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function rejectBill(input: unknown): Promise<Result> {
  try {
    await requireAdmin();
    const r = rejectInput.safeParse(input);
    if (!r.success) throw new UserError("A reason is required.");
    const [bill] = await withDb((sql) => sql<BillRow[]>`update bills set status = 'rejected', reject_reason = ${r.data.reason} where id = ${r.data.billId}::uuid and status = 'pending_review' returning id,requester_id,status_token,biller_name,amount_cents,first_name,reject_reason,payment_confirmation`);
    if (!bill) throw new UserError("That bill is no longer pending.");
    await emailRequester("rejected", bill);
    revalidatePath("/admin/review");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function startPaying(billId: string): Promise<Result> {
  try {
    await requireAdmin();
    const id = idOnly.parse({ billId }).billId;
    const rows = await withDb((sql) => sql`update bills set status = 'paying' where id = ${id}::uuid and status = 'funded' returning id`);
    if (!rows.length) throw new UserError("Someone else already picked this one up.");
    revalidatePath("/admin/payouts");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Admin paid the biller outside the app: record the confirmation (+ optional proof in R2) and close the loop by email. */
export async function markPaid(form: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const p = payoutInput.safeParse({ billId: form.get("billId"), confirmation: form.get("confirmation") });
    if (!p.success) throw new UserError("Enter the biller's confirmation number.");
    const [bill] = await withDb((sql) => sql<{ id: string; status: string; biller_name: string; account_last4: string | null; amount_cents: number }[]>`select id,status,biller_name,account_last4,amount_cents from bills where id = ${p.data.billId}::uuid`);
    if (!bill || !["funded", "paying"].includes(bill.status)) throw new UserError("This bill isn't waiting for payout.");

    let proofKey: string | undefined;
    const proof = form.get("proof");
    if (proof instanceof File && proof.size > 0) {
      if (proof.size > MAX_UPLOAD_BYTES) throw new UserError("Proof file is over 8 MB.");
      if (!(proof.type in IMAGE_TYPES)) throw new UserError("Proof must be a JPG, PNG, WebP or PDF.");
      proofKey = newKey("proofs", proof.type);
      await putObject(proofKey, new Uint8Array(await proof.arrayBuffer()), proof.type);
    }

    const res = await payProvider().settle({ billId: bill.id, billerName: bill.biller_name, accountLast4: bill.account_last4, amountCents: bill.amount_cents, confirmation: p.data.confirmation, proofPath: proofKey });
    const [paid] = await withDb((sql) => sql<BillRow[]>`
      update bills set status = 'paid', payment_confirmation = ${res.confirmation}, payment_proof_key = ${res.proofPath ?? null}, paid_at = now()
      where id = ${bill.id}::uuid and status in ('funded','paying')
      returning id,requester_id,status_token,biller_name,amount_cents,first_name,reject_reason,payment_confirmation`);
    if (!paid) throw new UserError("Couldn't mark this paid.");

    await emailRequester("paid", paid);
    await emailGiversPaid(paid.id, paid.biller_name, res.confirmation);
    revalidatePath("/admin/payouts");
    return { ok: true };
  } catch (e) { console.error("markPaid", e); return fail(e); }
}
