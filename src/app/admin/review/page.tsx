import { ReviewButtons } from "@/components/AdminForms";
import { requireAdmin } from "@/lib/auth";
import { dollars } from "@/lib/money";
import { withDb } from "@/lib/db";
import { presignGet } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function Review() {
  await requireAdmin(); // middleware guards the route; this guards the data
  const bills = await withDb((sql) => sql`select * from bills where status = 'pending_review' order by created_at`);
  const withImages = await Promise.all(bills.map(async (b) => {
    const url = b.image_path ? await presignGet(b.image_path, 300) : null; // short-lived signed GET
    const { data: u } = await supabaseAdmin().auth.admin.getUserById(b.requester_id);
    return { b, url, email: u.user?.email ?? "?" };
  }));
  return (
    <>
      <h1>Review queue ({withImages.length})</h1>
      {withImages.length === 0 && <div className="empty" style={{ marginTop: 14 }}><b>Nothing to review.</b></div>}
      {withImages.map(({ b, url, email }) => (
        <div className="panel" key={b.id}>
          {url ? (b.image_path.endsWith(".pdf")
            ? <a className="btn block" href={url} target="_blank" rel="noreferrer">Open bill PDF</a>
            // eslint-disable-next-line @next/next/no-img-element
            : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Bill from ${b.biller_name}`} style={{ width: "100%", maxHeight: 360, objectFit: "contain", background: "#fff", borderRadius: 8 }} /></a>) : <p className="sub">No image.</p>}
          <div className="rule" />
          <div className="row"><span>Biller</span><span>{b.biller_name}</span></div>
          <div className="row"><span>Type</span><span>{b.category}</span></div>
          <div className="row"><span>Amount</span><span>{dollars(b.amount_cents)}</span></div>
          <div className="row"><span>Due</span><span>{b.due_date}</span></div>
          <div className="row"><span>Account</span><span>{b.account_last4 ? `•••• ${b.account_last4}` : "none"}</span></div>
          <div className="row"><span>Shown as</span><span>{b.first_name} · {b.city}</span></div>
          <div className="row"><span>Requester</span><span>{email}</span></div>
          {b.note && <p className="note">“{b.note}”</p>}
          <ReviewButtons billId={b.id} />
        </div>
      ))}
    </>
  );
}
