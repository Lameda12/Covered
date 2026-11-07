import { PayoutForm } from "@/components/AdminForms";
import { requireAdmin } from "@/lib/auth";
import { dollars } from "@/lib/money";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function Payouts() {
  await requireAdmin();
  const { data: bills } = await createList();
  return (
    <>
      <h1>Payouts ({bills.length})</h1>
      <p className="sub">Pay the biller outside the app, then enter the confirmation number. Both sides get emailed.</p>
      {bills.length === 0 && <div className="empty" style={{ marginTop: 14 }}><b>No funded bills waiting.</b></div>}
      {bills.map((b) => (
        <div className="panel" key={b.id}>
          <div className="top" style={{ display: "flex", justifyContent: "space-between" }}><span className="tag">{b.category}</span><span className="due">{b.status === "paying" ? "In progress" : "Funded"}</span></div>
          <div className="biller">{b.biller_name}</div>
          <div className="amt" style={{ fontSize: 34 }}>{dollars(b.amount_cents)}</div>
          <div className="row"><span>Account</span><span>{b.account_last4 ? `•••• ${b.account_last4}` : "see bill image"}</span></div>
          <div className="row"><span>Due</span><span>{b.due_date}</span></div>
          <div className="row"><span>For</span><span>{b.first_name} · {b.city}</span></div>
          <PayoutForm billId={b.id} status={b.status} />
        </div>
      ))}
    </>
  );
}

async function createList() {
  const { data } = await supabaseAdmin().from("bills").select("*").in("status", ["funded", "paying"]).order("due_date");
  return { data: data ?? [] };
}
