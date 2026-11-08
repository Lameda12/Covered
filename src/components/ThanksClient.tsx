"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { checkSession, type SessionState } from "@/app/actions/give";
import { dollars } from "@/lib/money";

export function ThanksClient({ sessionId }: { sessionId: string }) {
  const [s, setS] = useState<SessionState>({ state: "pending" });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (s.state === "done" || tries > 25) return;
    const t = setTimeout(async () => { try { setS(await checkSession(sessionId)); } catch {} setTries((n) => n + 1); }, tries === 0 ? 100 : 1500);
    return () => clearTimeout(t);
  }, [s, tries, sessionId]);

  if (s.state === "pending") {
    return tries > 25 ? (
      <div className="panel"><b>Payment received.</b><p className="sub">It&apos;s taking a moment to apply. Your receipt email will confirm it.</p></div>
    ) : <div className="skeleton" style={{ height: 220 }} role="status" aria-label="Confirming your payment" />;
  }
  if (s.kind === "sweep") {
    return (
      <div className="panel">
        <div className="serif" style={{ fontSize: 24, fontWeight: 700 }}>{s.bills} bills covered.</div>
        <p className="sub">{dollars(s.appliedCents)} is on its way to billers.{s.refundedCents > 0 ? ` ${dollars(s.refundedCents)} of your budget was left over and is being refunded.` : ""}</p>
      </div>
    );
  }
  const none = s.appliedCents === 0;
  return (
    <div className="panel" style={{ position: "relative", minHeight: 260 }}>
      {s.billFunded && !none && <div className="stamp go" style={{ top: 40 }}>PAID</div>}
      <div className="serif" style={{ fontSize: 24, fontWeight: 700 }}>
        {none ? "Someone beat you to it." : s.billFunded ? `Covered. ${s.biller} gets paid.` : `${dollars(s.appliedCents)} in. ${s.pct}% covered.`}
      </div>
      <p className="sub" style={{ marginTop: 120 }}>
        {none ? "This bill was fully funded a moment earlier, so your payment is being refunded in full." :
          s.refundedCents > 0 ? `Part of your gift was no longer needed, so ${dollars(s.refundedCents)} is being refunded.` :
          s.billFunded ? "Our team pays the biller within 2 business days and emails you the confirmation number." : "Thank you. The rest of the bill is still open to other givers."}
      </p>
    </div>
  );
}

export function BackToDeck() { return <Link href="/" className="btn solid block" style={{ marginTop: 14 }}>Cover another bill</Link>; }
