import "server-only";
import { Resend } from "resend";
import { siteUrl } from "@/lib/env";
import { dollars } from "@/lib/money";
import { withDb } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase/admin";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function layout(title: string, body: string, cta?: { href: string; label: string }) {
  return `<!doctype html><html><body style="margin:0;background:#F2EDE3;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#121212">
  <div style="max-width:480px;margin:0 auto">
    <div style="font:900 28px Georgia,serif;letter-spacing:-.03em;margin-bottom:12px">Covered<span style="color:#0BB35E">.</span></div>
    <div style="background:#FFFDF8;border:1px solid #dcd4c4;border-radius:14px;padding:22px">
      <h1 style="font:700 22px/1.2 Georgia,serif;margin:0 0 12px">${esc(title)}</h1>
      <div style="font-size:15px;line-height:1.55">${body}</div>
      ${cta ? `<p style="margin:22px 0 0"><a href="${cta.href}" style="display:inline-block;background:#121212;color:#F2EDE3;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:12px">${esc(cta.label)}</a></p>` : ""}
    </div>
    <p style="font:11px monospace;color:#6f695e;margin-top:14px">Payouts to billers are processed by our team within 2 business days.</p>
  </div></body></html>`;
}

export async function sendEmail(to: string | string[], subject: string, html: string) {
  const list = Array.isArray(to) ? to : [to];
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email:dev] to=${list.join(",")} subject=${subject}\n${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400)}`);
    return;
  }
  try {
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.EMAIL_FROM || "Covered <onboarding@resend.dev>", to: list, subject, html,
    });
    if (error) console.error("resend error", error);
  } catch (e) {
    // Email must never break a payment path.
    console.error("sendEmail failed", e);
  }
}

/** Magic link straight into /receipts. Falls back to the plain page if the link can't be generated. */
export async function receiptsLink(email: string): Promise<string> {
  const fallback = `${siteUrl()}/receipts`;
  try {
    const { data, error } = await supabaseAdmin().auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data.properties?.hashed_token) return fallback;
    return `${siteUrl()}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=/receipts`;
  } catch {
    return fallback;
  }
}

async function requesterEmail(requesterId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(requesterId);
  return data.user?.email ?? null;
}

type BillRow = { id: string; requester_id: string; status_token: string; biller_name: string; amount_cents: number; first_name: string };
const statusUrl = (b: Pick<BillRow, "status_token">) => `${siteUrl()}/r/${b.status_token}`;

export async function emailRequester(kind: "received" | "live" | "funded" | "paid" | "rejected", bill: BillRow & { reject_reason?: string | null; payment_confirmation?: string | null }) {
  const to = await requesterEmail(bill.requester_id);
  if (!to) return;
  const amt = dollars(bill.amount_cents);
  const copy = {
    received: ["We got your bill", `We received your ${esc(bill.biller_name)} bill for ${amt}. A person on our team checks it against the biller, usually within a day. We will email you the moment it goes live.`, "Check status"],
    live: ["Your bill is live", `Your ${esc(bill.biller_name)} bill for ${amt} is now visible to givers. You stay anonymous: only your first name and city show.`, "Watch it get covered"],
    funded: ["Your bill is fully covered", `Givers covered all ${amt}. Our team now pays ${esc(bill.biller_name)} directly, usually within 2 business days. Nothing for you to do.`, "Check status"],
    paid: ["Paid to " + bill.biller_name, `${esc(bill.biller_name)} has been paid ${amt}. Confirmation number: <b style="font-family:monospace">${esc(bill.payment_confirmation ?? "")}</b>. You can leave a thank-you for the people who covered it.`, "Say thanks"],
    rejected: ["We could not approve this bill", `We were not able to approve your ${esc(bill.biller_name)} bill.<br><br><b>Reason:</b> ${esc(bill.reject_reason ?? "Not specified")}<br><br>You can submit a new request any time.`, "Start a new request"],
  }[kind];
  await sendEmail(to, copy[0], layout(copy[0], copy[1], { href: kind === "rejected" ? `${siteUrl()}/help` : statusUrl(bill), label: copy[2] }));
}

export async function emailGiverReceipt(to: string, lines: { biller: string; city: string; category: string; cents: number }[], opts: { refundedCents?: number; kind: "cover" | "chip" | "sweep"; feeCents?: number }) {
  const total = lines.reduce((s, l) => s + l.cents, 0);
  const rows = lines.map((l) => `<tr><td style="padding:5px 0">${esc(l.category)} · ${esc(l.biller)} · ${esc(l.city)}</td><td style="text-align:right;font-family:monospace">${dollars(l.cents)}</td></tr>`).join("");
  const refund = opts.refundedCents ? `<p style="color:#6f695e">${dollars(opts.refundedCents)} was refunded to your card${opts.kind === "sweep" ? " (budget left over)" : " because the bill was fully covered by someone else a moment earlier"}. It can take 5 to 10 days to show up.</p>` : "";
  const title = lines.length ? `Thank you. ${dollars(total)} is on its way to ${lines.length === 1 ? lines[0].biller : lines.length + " billers"}` : "Your payment was refunded";
  const body = `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>${refund}
    <p>Your money goes to the biller, never to the person. Our team pays them within 2 business days and you will get the confirmation number by email.</p>
    <p style="font-size:13px;color:#6f695e">Your link below signs you in without a password and shows your full giving history.</p>`;
  await sendEmail(to, title, layout(title, body, { href: await receiptsLink(to), label: "See my receipts" }));
}

export async function emailGiversPaid(billId: string, billerName: string, confirmation: string) {
  const data = await withDb((sql) => sql<{ giver_email: string | null; amount_cents: number }[]>`select giver_email, amount_cents from contributions where bill_id = ${billId}::uuid and amount_cents > 0`);
  const byEmail = new Map<string, number>();
  for (const c of data) if (c.giver_email) byEmail.set(c.giver_email, (byEmail.get(c.giver_email) ?? 0) + c.amount_cents);
  await Promise.all([...byEmail].map(async ([to, cents]) => {
    const title = `Paid: your ${dollars(cents)} reached ${billerName}`;
    await sendEmail(to, title, layout(title, `${esc(billerName)} confirmed payment. Confirmation number: <b style="font-family:monospace">${esc(confirmation)}</b>.`, { href: await receiptsLink(to), label: "See my receipts" }));
  }));
}
