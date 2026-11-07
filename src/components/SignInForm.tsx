"use client";
import { useState, useTransition } from "react";
import { sendMagicLink } from "@/app/actions/help";

export function SignInForm({ next, notice }: { next: string; notice?: string }) {
  const [mail, setMail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (sent) return <div className="panel" role="status"><b>Check your inbox.</b><p className="sub">We sent a sign-in link to {mail}. No password needed.</p></div>;
  return (
    <div className="panel">
      {notice && <p className="err-text" role="alert" style={{ marginTop: 0 }}>{notice}</p>}
      <label className="lbl lbl-tight" style={{ display: "block" }}>Email you gave with
        <input className="txt" type="email" inputMode="email" autoComplete="email" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="you@example.com" />
      </label>
      {err && <p className="err-text" role="alert">{err}</p>}
      <button className="btn solid block" style={{ marginTop: 12 }} disabled={busy || !mail.includes("@")}
        onClick={() => start(async () => { const r = await sendMagicLink(mail, next); r.ok ? setSent(true) : setErr(r.error); })}>
        {busy ? "Sending…" : "Email me a sign-in link"}
      </button>
    </div>
  );
}
