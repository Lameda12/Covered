"use server";

import { randomUUID } from "node:crypto";
import { siteUrl } from "@/lib/env";
import { fail, UserError, type Result } from "@/lib/auth";
import { readBill, type ImageMime } from "@/lib/anthropic";
import { emailRequester } from "@/lib/email";
import { rateLimit } from "@/lib/ratelimit";
import { safeNext } from "@/lib/redirect";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { billDraft, email as emailSchema, thankYou, type ExtractedBill } from "@/lib/validation";

const MAX_BYTES = 8 * 1024 * 1024;

function sniff(buf: Buffer): { mime: ImageMime; ext: string } | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (buf.subarray(0, 4).toString() === "%PDF") return { mime: "application/pdf", ext: "pdf" };
  return null;
}

/** Step 1: photo -> private storage -> Claude reads it. Works signed out; the file is claimed at submit. */
export async function uploadBill(form: FormData): Promise<Result<{ path: string; extracted: ExtractedBill | null }>> {
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a photo of your bill.");
    if (file.size > MAX_BYTES) throw new UserError("That file is over 8 MB. Try a smaller photo.");
    const user = await currentUser();
    await rateLimit("upload", { limit: 8, windowSeconds: 600, userId: user?.id });

    const buf = Buffer.from(await file.arrayBuffer());
    const type = sniff(buf);
    if (!type) throw new UserError("Please upload a JPG, PNG, WebP or PDF.");

    const path = `uploads/${randomUUID()}.${type.ext}`;
    const { error } = await supabaseAdmin().storage.from("bills").upload(path, buf, { contentType: type.mime, upsert: false });
    if (error) throw error;
    return { ok: true, path, extracted: await readBill(buf, type.mime) };
  } catch (e) {
    console.error("uploadBill", e);
    return fail(e, "Upload failed. Please try again.");
  }
}

/** Step 3 sign-in: email magic link. The draft lives in the browser so the user can come back to it. */
export async function sendMagicLink(rawEmail: string, next: string): Promise<Result> {
  try {
    const email = emailSchema.safeParse(rawEmail);
    if (!email.success) throw new UserError("Enter a valid email address.");
    await rateLimit("magic-link", { limit: 5, windowSeconds: 600 });
    const sb = await supabaseServer();
    const { error } = await sb.auth.signInWithOtp({
      email: email.data,
      options: { emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(safeNext(next))}` },
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.error("sendMagicLink", e);
    return fail(e, "Couldn't send the link. Check the address and try again.");
  }
}

/** Step 3: submit. Requires a signed-in user. Creates the bill as pending_review and emails the status link. */
export async function submitBill(input: unknown): Promise<Result<{ token: string }>> {
  try {
    const user = await currentUser();
    if (!user) throw new UserError("Please sign in with your email first.");
    await rateLimit("submit-bill", { limit: 5, windowSeconds: 3600, userId: user.id });

    const d = billDraft.safeParse(input);
    if (!d.success) throw new UserError(d.error.issues[0]?.message ?? "Check the highlighted fields.");
    const draft = d.data;
    const cents = Math.round(draft.amount_dollars * 100);
    if (cents < 100 || cents > 150000) throw new UserError("Bills must be between $1 and $1,500.");
    const due = new Date(draft.due_date + "T00:00:00Z").getTime();
    const now = Date.now();
    if (Number.isNaN(due) || due < now - 14 * 864e5 || due > now + 60 * 864e5) throw new UserError("The due date should be within the next 60 days.");
    if (!/^uploads\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(draft.image_path)) throw new UserError("Please upload your bill again.");

    const sb = supabaseAdmin();
    const dest = `${user.id}/${draft.image_path.split("/")[1]}`;
    const { error: mvErr } = await sb.storage.from("bills").move(draft.image_path, dest);
    if (mvErr) throw new UserError("Please upload your bill again.");

    const { data: bill, error } = await sb.from("bills").insert({
      requester_id: user.id, category: draft.category, biller_name: draft.biller_name, account_last4: draft.account_last4 || null,
      amount_cents: cents, due_date: draft.due_date, city: draft.city, first_name: draft.first_name, note: draft.note || null, image_path: dest,
    }).select("id,requester_id,status_token,biller_name,amount_cents,first_name").single();
    if (error) {
      if (error.code === "23505") {
        const { data: open } = await sb.from("bills").select("status_token").eq("requester_id", user.id).in("status", ["pending_review", "live", "funded", "paying"]).single();
        throw new UserError(`You already have an open request. Check its status at /r/${open?.status_token ?? ""}`);
      }
      throw error;
    }
    await emailRequester("received", bill);
    return { ok: true, token: bill.status_token };
  } catch (e) {
    console.error("submitBill", e);
    return fail(e, "We couldn't submit your request. Please try again.");
  }
}

/** Requester says thanks once the bill is paid. The unguessable status token is the credential. */
export async function postThankYou(input: unknown): Promise<Result> {
  try {
    const t = thankYou.safeParse(input);
    if (!t.success) throw new UserError("Write a line of up to 200 characters.");
    await rateLimit("thanks", { limit: 5, windowSeconds: 600 });
    const sb = supabaseAdmin();
    const { data: bill } = await sb.from("bills").select("id,status").eq("status_token", t.data.token).single();
    if (!bill || bill.status !== "paid") throw new UserError("You can say thanks once the bill is paid.");
    const { error } = await sb.from("thank_yous").insert({ bill_id: bill.id, body: t.data.body });
    if (error) throw new UserError(error.code === "23505" ? "You already sent a thank-you." : "Couldn't save that.");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
