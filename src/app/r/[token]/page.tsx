import { notFound } from "next/navigation";
import { BillCard, type PublicBill } from "@/components/BillCard";
import { ThankYouBox } from "@/components/ThankYouBox";
import { dollars } from "@/lib/money";
import { withDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your request · Covered", robots: { index: false, follow: false } };

const STEPS = [["pending_review", "Received. A person on our team is checking it."], ["live", "Live. Givers can see and cover it."], ["funded", "Fully covered by givers."], ["paid", "Paid to the biller."]] as const;
const ORDER = ["pending_review", "live", "funded", "paying", "paid"];

export default async function Status({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{48}$/.test(token)) notFound();
  const found = await withDb(async (sql) => {
    const [bill] = await sql<(PublicBill & { id: string; status: string; reject_reason: string | null; payment_confirmation: string | null })[]>`select id,status,category,biller_name,account_last4,amount_cents,funded_cents,due_date,city,first_name,note,reject_reason,payment_confirmation from bills where status_token = ${token}`;
    if (!bill) return null;
    const [thanks] = await sql<{ body: string }[]>`select body from thank_yous where bill_id = ${bill.id}::uuid`;
    return { bill, thanks };
  });
  if (!found) notFound();
  const { bill, thanks } = found;
  const idx = ORDER.indexOf(bill.status);
  const dead = bill.status === "rejected" || bill.status === "expired";

  return (
    <>
      <h1>{bill.status === "paid" ? `${bill.biller_name} is paid.` : dead ? (bill.status === "rejected" ? "We couldn't approve this bill." : "This request expired.") : "Your request"}</h1>
      <p className="sub">This private page is the link in your emails. Don&apos;t share it.</p>

      {dead ? (
        <div className="panel">
          {bill.status === "rejected" ? <><b>Reason</b><p className="sub">{bill.reject_reason}</p></> : <p className="sub">Bills expire 7 days after their due date. Any money given toward it is refunded to the givers.</p>}
          <a className="btn solid block" style={{ marginTop: 12 }} href="/help">Start a new request</a>
        </div>
      ) : (
        <>
          <ol className="tl panel">
            {STEPS.map(([k, label], i) => {
              const done = idx >= ORDER.indexOf(k) || (k === "funded" && bill.status === "paying");
              return <li key={k} className={done ? "done" : ""}><b>{done ? "✓" : i + 1}</b><span>{label}{k === "live" && bill.status === "live" ? ` ${dollars(bill.funded_cents, 0)} of ${dollars(bill.amount_cents, 0)} so far.` : ""}</span></li>;
            })}
          </ol>
          <BillCard bill={bill} paid={bill.status === "paid"} />
          {bill.status === "paid" && (
            <div className="panel" style={{ marginTop: 24 }}>
              <div className="lbl lbl-tight">Biller confirmation</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{bill.payment_confirmation}</div>
              <h2 style={{ marginTop: 18 }}>Say thanks</h2>
              {thanks ? <p className="serif" style={{ fontStyle: "italic" }}>“{thanks.body}”</p> : <ThankYouBox token={token} />}
            </div>
          )}
        </>
      )}
    </>
  );
}
