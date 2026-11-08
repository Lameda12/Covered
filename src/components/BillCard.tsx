import { dollars, daysUntil } from "@/lib/money";

export type PublicBill = {
  id: string; category: string; biller_name: string; account_last4: string | null; amount_cents: number; funded_cents: number;
  due_date: string; city: string; first_name: string; note: string | null;
};

/** The receipt-style bill card. Pure markup so it renders on the server and inside the swipe deck. */
export function BillCardBody({ bill, paid = false, drag = 0 }: { bill: PublicBill; paid?: boolean; drag?: number }) {
  const remaining = bill.amount_cents - bill.funded_cents;
  const pct = Math.round((bill.funded_cents / bill.amount_cents) * 100);
  const days = daysUntil(bill.due_date);
  const dueText = days < 0 ? `Overdue ${-days} day${days === -1 ? "" : "s"}` : days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}`;
  return (
    <>
      <span className="hint l" aria-hidden style={{ opacity: Math.max(0, Math.min(1, -drag / 100)) }}>PASS</span>
      <span className="hint r" aria-hidden style={{ opacity: Math.max(0, Math.min(1, drag / 100)) }}>COVER</span>
      <div className="top">
        <span className="tag">{bill.category}</span>
        <span className={`due ${days <= 3 ? "hot" : ""}`}>{dueText}</span>
      </div>
      <div className="biller">{bill.biller_name}</div>
      <div className="amt">
        {dollars(paid ? bill.amount_cents : remaining)}
        {bill.funded_cents > 0 && !paid && <small>of {dollars(bill.amount_cents)}</small>}
      </div>
      <div className="rule" />
      <div className="row"><span>For</span><span>{bill.first_name} · {bill.city}</span></div>
      {bill.account_last4 && <div className="row"><span>Account</span><span>•••• {bill.account_last4}</span></div>}
      <div className="row"><span>Pays to</span><span>{bill.biller_name.split(" ")[0]} directly</span></div>
      {bill.note ? <div className="note">“{bill.note}”</div> : <div className="note none">No story shared. That&apos;s fine here.</div>}
      <div className="checks"><span className="ck">✓ Bill read</span><span className="ck">✓ Reviewed by our team</span><span className="ck">✓ Biller gets paid</span></div>
      <div className="bar" role="progressbar" aria-valuenow={paid ? 100 : pct} aria-valuemin={0} aria-valuemax={100} aria-label="Covered so far"><i style={{ width: `${paid ? 100 : pct}%` }} /></div>
      <div className="barlbl"><span>{paid ? 100 : pct}% covered</span><span>{dollars(paid ? bill.amount_cents : bill.funded_cents)} raised</span></div>
      <div className={`stamp ${paid ? "go" : ""}`} aria-hidden={!paid}>PAID</div>
    </>
  );
}

export function BillCard({ bill, paid }: { bill: PublicBill; paid?: boolean }) {
  return <article className="bill static"><BillCardBody bill={bill} paid={paid} /></article>;
}
