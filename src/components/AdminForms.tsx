"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveBill, markPaid, rejectBill, startPaying } from "@/app/actions/admin";

function useAct() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); if (r.ok) { setErr(null); router.refresh(); } else setErr(r.error ?? "Failed"); });
  return { err, busy, run };
}

export function ReviewButtons({ billId }: { billId: string }) {
  const { err, busy, run } = useAct();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div style={{ marginTop: 12 }}>
      {!rejecting ? (
        <div className="actions" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <button className="btn" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
          <button className="btn go" disabled={busy} onClick={() => run(() => approveBill(billId))}>{busy ? "Approving…" : "Approve"}</button>
        </div>
      ) : (
        <>
          <label className="lbl lbl-tight" style={{ display: "block" }}>Reason (emailed to the requester)<textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></label>
          <div className="actions" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
            <button className="btn" onClick={() => setRejecting(false)}>Back</button>
            <button className="btn solid" disabled={busy || !reason.trim()} onClick={() => run(() => rejectBill({ billId, reason }))}>{busy ? "Rejecting…" : "Send rejection"}</button>
          </div>
        </>
      )}
      {err && <p className="err-text" role="alert">{err}</p>}
    </div>
  );
}

export function PayoutForm({ billId, status }: { billId: string; status: string }) {
  const { err, busy, run } = useAct();
  return (
    <div style={{ marginTop: 12 }}>
      {status === "funded" && <button className="btn block" disabled={busy} onClick={() => run(() => startPaying(billId))}>I&apos;m paying this one</button>}
      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => markPaid(fd)); }}>
        <input type="hidden" name="billId" value={billId} />
        <label className="lbl" style={{ display: "block" }}>Biller confirmation number<input className="txt" name="confirmation" required minLength={3} maxLength={80} /></label>
        <label className="lbl" style={{ display: "block" }}>Proof of payment (optional)<input className="txt" type="file" name="proof" accept="image/*,application/pdf" style={{ paddingTop: 10 }} /></label>
        <button className="btn go block" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Mark paid and email everyone"}</button>
      </form>
      {err && <p className="err-text" role="alert">{err}</p>}
    </div>
  );
}
