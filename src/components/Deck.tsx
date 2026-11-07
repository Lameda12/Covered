"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { createCheckout } from "@/app/actions/give";
import { BillCardBody, type PublicBill } from "@/components/BillCard";
import { cardFeeCents, dollars } from "@/lib/money";

const FILTERS = [["urgent", "Most urgent"], ["rent", "Rent"], ["utilities", "Utilities"], ["medical", "Medical"]] as const;
const UTIL = ["electric", "heat", "water", "internet", "phone"];
type Filter = (typeof FILTERS)[number][0];

export function Deck({ bills }: { bills: PublicBill[] }) {
  const [filter, setFilter] = useState<Filter>("urgent");
  const [passed, setPassed] = useState<string[]>([]);
  const [chipFor, setChipFor] = useState<PublicBill | null>(null);
  const [coverFee, setCoverFee] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [drag, setDrag] = useState(0);
  const startX = useRef<number | null>(null);

  const list = useMemo(() => {
    const f = bills.filter((b) => filter === "urgent" || (filter === "rent" && b.category === "rent") || (filter === "medical" && b.category === "medical") || (filter === "utilities" && UTIL.includes(b.category)));
    // passed bills go to the back of the line
    return [...f.filter((b) => !passed.includes(b.id)), ...f.filter((b) => passed.includes(b.id))];
  }, [bills, filter, passed]);
  const top = list[0];

  function go(bill: PublicBill, mode: "cover" | "chip", amountCents?: number) {
    setError(null);
    start(async () => {
      const res = await createCheckout({ billId: bill.id, mode, amountCents, coverFee });
      if (res.ok) window.location.assign(res.url);
      else { setError(res.error); setChipFor(null); }
    });
  }
  const pass = () => { if (top) { setPassed((p) => [...p.filter((x) => x !== top.id), top.id]); setDrag(0); } };

  return (
    <>
      <div className="chips" role="group" aria-label="Filter bills">
        {FILTERS.map(([k, l]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
      </div>

      <div className="stack" aria-live="polite">
        {!top ? (
          <div className="empty">
            <div className="serif" style={{ fontSize: 22, fontWeight: 700 }}>{bills.length ? "Nothing in this filter." : "Board cleared."}</div>
            <p className="sub">{bills.length ? "Try another filter." : "Every verified bill is covered. Check back soon, new requests arrive daily."}</p>
          </div>
        ) : (
          list.slice(0, 3).reverse().map((b, ri, arr) => {
            const i = arr.length - 1 - ri;
            const isTop = i === 0;
            return (
              <article key={b.id} className="bill" aria-hidden={!isTop}
                style={{ zIndex: 10 - i, opacity: i === 0 ? 1 : i === 1 ? 0.9 : 0.7, transition: isTop && startX.current != null ? "none" : undefined,
                  transform: isTop ? `translate(${drag}px,0) rotate(${drag / 20}deg)` : `translateY(${i * 12}px) scale(${1 - i * 0.045})` }}
                onPointerDown={isTop ? (e) => { startX.current = e.clientX; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } : undefined}
                onPointerMove={isTop ? (e) => { if (startX.current != null) setDrag(e.clientX - startX.current); } : undefined}
                onPointerUp={isTop ? () => { const d = drag; startX.current = null; if (d > 110) { setDrag(0); go(b, "cover"); } else if (d < -110) pass(); else setDrag(0); } : undefined}
                onPointerCancel={isTop ? () => { startX.current = null; setDrag(0); } : undefined}>
                <BillCardBody bill={b} drag={isTop ? drag : 0} />
              </article>
            );
          })
        )}
      </div>

      {top && (
        <>
          <div className="actions">
            <button className="btn" onClick={pass} disabled={pending}>Pass</button>
            <button className="btn" onClick={() => setChipFor(top)} disabled={pending}>Chip in</button>
            <button className="btn go" onClick={() => go(top, "cover")} disabled={pending}>
              {pending ? "Opening checkout…" : `Cover it ${dollars(top.amount_cents - top.funded_cents, 0)}`}
            </button>
          </div>
          <div className="toggle" style={{ marginTop: 6 }}>
            <span id="fee-l">Cover the card fee{top ? ` (+${dollars(cardFeeCents(top.amount_cents - top.funded_cents))})` : ""}</span>
            <button className="sw" role="switch" aria-checked={coverFee} aria-labelledby="fee-l" onClick={() => setCoverFee(!coverFee)} />
          </div>
          {error && <p className="err-text" role="alert">{error}</p>}
          <p className="sub" style={{ textAlign: "center", fontSize: 12 }}>Swipe right to cover, left to pass, or tap the buttons. Apple Pay and Google Pay at checkout, no account needed.</p>
        </>
      )}

      {chipFor && <ChipSheet bill={chipFor} coverFee={coverFee} pending={pending} onClose={() => setChipFor(null)} onPay={(c) => go(chipFor, "chip", c)} />}
    </>
  );
}

function ChipSheet({ bill, coverFee, pending, onClose, onPay }: { bill: PublicBill; coverFee: boolean; pending: boolean; onClose: () => void; onPay: (cents: number) => void }) {
  const remaining = bill.amount_cents - bill.funded_cents;
  const [choice, setChoice] = useState<number | "custom">(2500);
  const [custom, setCustom] = useState("");
  const cents = choice === "custom" ? Math.round(parseFloat(custom || "0") * 100) : choice;
  const min = Math.min(500, remaining);
  const valid = Number.isFinite(cents) && cents >= min && cents <= 150000;
  const eff = Math.min(cents, remaining);
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Chip in" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="in">
        <div className="serif" style={{ fontSize: 22, fontWeight: 700 }}>Chip in on {bill.first_name}&apos;s {bill.category}</div>
        <p className="sub">{dollars(remaining)} still owed to {bill.biller_name}. Every dollar goes to the biller.</p>
        <div className="chips" role="group" aria-label="Amount">
          {[1000, 2500, 5000].map((c) => <button key={c} className="chip" aria-pressed={choice === c} onClick={() => setChoice(c)}>{dollars(c, 0)}</button>)}
          <button className="chip" aria-pressed={choice === "custom"} onClick={() => setChoice("custom")}>Custom</button>
        </div>
        {choice === "custom" && (
          <label className="lbl" style={{ display: "block" }}>Amount in dollars
            <input className="num" inputMode="decimal" autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="40" />
          </label>
        )}
        {!valid && choice === "custom" && custom && <p className="err-text">Enter at least {dollars(min, 0)}.</p>}
        <button className="btn go block" style={{ marginTop: 16 }} disabled={!valid || pending} onClick={() => onPay(cents)}>
          {pending ? "Opening checkout…" : `Chip in ${valid ? dollars(eff) : ""}${coverFee && valid ? " + fee" : ""}`}
        </button>
        <button className="btn block" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
