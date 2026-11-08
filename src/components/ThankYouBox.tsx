"use client";
import { useState, useTransition } from "react";
import { postThankYou } from "@/app/actions/help";

export function ThankYouBox({ token }: { token: string }) {
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, start] = useTransition();
  if (done) return <p role="status"><b>Sent.</b> Givers will see it in their receipts.</p>;
  return (
    <>
      <p className="sub">Optional. Givers see this with their receipt. Your name stays private.</p>
      <label className="lbl" style={{ display: "block" }}>Your message ({200 - body.length} left)
        <textarea maxLength={200} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The heat came back on before my kids woke up." />
      </label>
      {err && <p className="err-text" role="alert">{err}</p>}
      <button className="btn solid block" style={{ marginTop: 10 }} disabled={busy || !body.trim()} onClick={() => start(async () => { const r = await postThankYou({ token, body }); r.ok ? setDone(true) : setErr(r.error); })}>
        {busy ? "Sending…" : "Send thank-you"}
      </button>
    </>
  );
}
