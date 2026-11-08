"use server";

import { siteUrl } from "@/lib/env";
import { fail, UserError, type Result } from "@/lib/auth";
import { readBill, type ImageMime } from "@/lib/anthropic";
import { emailRequester } from "@/lib/email";
import { rateLimit } from "@/lib/ratelimit";
import { safeNext } from "@/lib/redirect";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { withDb } from "@/lib/db";
import { deleteObject, getObject, IMAGE_TYPES, MAX_UPLOAD_BYTES, newKey, presignPut } from "@/lib/r2";
import { verifyTurnstile } from "@/lib/turnstile";
import { billDraft, email as emailSchema, thankYou, type ExtractedBill } from "@/lib/validation";

/** Step 1a: a presigned PUT so the photo goes straight from the phone to the private R2 bucket. */
export async function requestUpload(contentType: string, size: number, turnstileToken?: string | null): Promise<Result<{ key: string; url: string }>> {
  try {
    if (!(contentType in IMAGE_TYPES)) throw new UserError("Please upload a JPG, PNG, WebP or PDF.");
    if (!(size > 0) || size > MAX_UPLOAD_BYTES) throw new UserError("That file is over 8 MB. Try a smaller photo.");
    await verifyTurnstile(turnstileToken);
    const user = await currentUser();
    await rateLimit("upload", { limit: 8, windowSeconds: 600, userId: user?.id });
    const key = newKey("uploads", contentType);
    return { ok: true, key, url: await presignPut(key, contentType) };
  } catch (e) {
    console.error("requestUpload", e);
    return fail(e, "Upload failed. Please try again.");
  }
}

function sniff(buf: Uint8Array): { mime: ImageMime } | null {
  const b = Buffer.from(buf.subarray(0, 16));
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8) return { mime: "image/jpeg" };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png" };
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return { mime: "image/webp" };
  if (b.subarray(0, 4).toString() === "%PDF") return { mime: "application/pdf" };
  return null;
}

/** Step 1b: after the browser PUT, check the object really is a bill-sized image, then let Claude read it. */
export async function processUpload(key: string): Promise<Result<{ path: string; extracted: ExtractedBill | null }>> {
  try {
    if (!/^uploads\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(key)) throw new UserError("Please upload your bill again.");
    const obj = await getObject(key);
    if (!obj) throw new UserError("The upload didn't finish. Please try again.");
    const type = obj.bytes.length <= MAX_UPLOAD_BYTES ? sniff(obj.bytes) : null;
    if (!type) { await deleteObject(key); throw new UserError("Please upload a JPG, PNG, WebP or PDF under 8 MB."); }
    return { ok: true, path: key, extracted: await readBill(Buffer.from(obj.bytes), type.mime) };
  } catch (e) {
    console.error("processUpload", e);
    return fail(e, "We couldn't read that file. Please try again.");
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

    if (!(await getObject(draft.image_path))) throw new UserError("Please upload your bill again.");

    const bill = await withDb(async (sql) => {
      try {
        const [row] = await sql<{ id: string; requester_id: string; status_token: string; biller_name: string; amount_cents: number; first_name: string }[]>`
          insert into bills (requester_id, category, biller_name, account_last4, amount_cents, due_date, city, first_name, note, image_path)
          values (${user.id}::uuid, ${draft.category}, ${draft.biller_name}, ${draft.account_last4 || null}, ${cents}::int, ${draft.due_date}::date, ${draft.city}, ${draft.first_name}, ${draft.note || null}, ${draft.image_path})
          returning id, requester_id, status_token, biller_name, amount_cents, first_name`;
        return row;
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          const [open] = await sql<{ status_token: string }[]>`select status_token from bills where requester_id = ${user.id}::uuid and status in ('pending_review','live','funded','paying') limit 1`;
          throw new UserError(`You already have an open request. Check its status at /r/${open?.status_token ?? ""}`);
        }
        throw e;
      }
    });
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
    await withDb(async (sql) => {
      const [bill] = await sql<{ id: string; status: string }[]>`select id, status from bills where status_token = ${t.data.token}`;
      if (!bill || bill.status !== "paid") throw new UserError("You can say thanks once the bill is paid.");
      try { await sql`insert into thank_yous (bill_id, body) values (${bill.id}::uuid, ${t.data.body})`; }
      catch (e) { throw new UserError((e as { code?: string }).code === "23505" ? "You already sent a thank-you." : "Couldn't save that."); }
    });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
