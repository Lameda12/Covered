import { SignInForm } from "@/components/SignInForm";
import { dollars } from "@/lib/money";
import { safeNext } from "@/lib/redirect";
import { currentUser } from "@/lib/supabase/server";
import { withDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your receipts · Covered" };

type Row = {
  id: string; amount_cents: number; refunded_cents: number; created_at: string; sweep_id: string | null;
  bills: { biller_name: string; city: string; category: string; status: string; payment_confirmation: string | null; thank_yous: { body: string }[] | null } | null;
};

export default async function Receipts({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) {
    return (
      <>
        <h1>Receipts, not vibes.</h1>
        <p className="sub">Every dollar shows up here as a biller confirmation. Sign in with the email you gave at checkout.</p>
        <SignInForm next={safeNext(sp.next, "/receipts")} notice={sp.error ? "That link expired. Request a new one." : undefined} />
      </>
    );
  }
  // Scoped to the verified email on the session. Only first-name-free, biller-level facts are shown.
  const email = (user.email ?? "").toLowerCase();
  const rows = await withDb((sql) => sql<Row[]>`
    select c.id, c.amount_cents, c.refunded_cents, c.created_at::text as created_at, c.sweep_id,
      json_build_object('biller_name', b.biller_name, 'city', b.city, 'category', b.category, 'status', b.status,
        'payment_confirmation', b.payment_confirmation,
        'thank_yous', coalesce((select json_agg(json_build_object('body', t.body)) from thank_yous t where t.bill_id = b.id), '[]'::json)) as bills
    from contributions c join bills b on b.id = c.bill_id
    where (c.giver_id = ${user.id}::uuid or c.giver_email = ${email}) and c.amount_cents > 0
    order by c.created_at desc limit 300`);
  const given = rows.reduce((s, r) => s + r.amount_cents - r.refunded_cents, 0);
  const paid = rows.filter((r) => r.bills?.status === "paid").length;
  const thanks = rows.flatMap((r) => (r.bills?.thank_yous ?? []).map((t) => ({ body: t.body, where: `${r.bills!.city} · ${r.bills!.category}` })));

  return (
    <>
      <h1>Receipts, not vibes.</h1>
      <p className="sub">Signed in as {user.email}.</p>
      <div className="panel" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><div className="lbl lbl-tight">You gave</div><div className="big">{dollars(given, 0)}</div></div>
        <div><div className="lbl lbl-tight">Bills paid out</div><div className="big">{paid}</div></div>
      </div>

      <h2>Your ledger</h2>
      <div className="panel">
        {rows.length === 0 ? <p className="sub" style={{ margin: 0 }}>Nothing yet. Cover a bill and its biller confirmation lands here.</p> : (
          <div className="ledger">
            {rows.map((r) => (
              <div key={r.id}>
                <span>{r.sweep_id ? "Sweep" : "Gift"} · {r.bills?.biller_name} · {r.bills?.city}</span>
                <span className={r.bills?.status === "paid" ? "pd" : ""}>{dollars(r.amount_cents - r.refunded_cents)}{r.bills?.status === "paid" ? ` · ${r.bills.payment_confirmation}` : r.bills?.status === "expired" ? " · refunded" : " · pending payout"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2>Thank-yous</h2>
      <div className="panel feed">
        {thanks.length === 0 ? <span className="sub">Thank-yous appear here once a bill you covered is paid.</span> :
          thanks.map((t, i) => <div key={i}><span className="serif" style={{ fontStyle: "italic", fontSize: 15.5 }}>“{t.body}”</span><br /><span className="mono" style={{ fontSize: 11, color: "var(--mute)" }}>{t.where}</span></div>)}
      </div>
      {/* TODO(v2): leaderboards, anonymous-giver toggle (profiles.is_anonymous already exists) */}
    </>
  );
}
