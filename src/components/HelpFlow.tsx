"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { processUpload, requestUpload, sendMagicLink, submitBill } from "@/app/actions/help";
import { TurnstileBox, useTurnstile } from "@/components/Turnstile";
import { CATEGORIES } from "@/lib/validation";

type Fields = { category: string; biller_name: string; account_last4: string; amount_dollars: string; due_date: string; city: string; first_name: string; note: string };
type Draft = { path: string; fields: Fields; lowConfidence: boolean; unread: boolean };
const KEY = "covered.draft.v1";
const EMPTY: Fields = { category: "electric", biller_name: "", account_last4: "", amount_dollars: "", due_date: "", city: "", first_name: "", note: "" };

export function HelpFlow({ email }: { email: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [reading, setReading] = useState(false);
  const [mail, setMail] = useState("");
  const [sent, setSent] = useState(false);
  const ts = useTurnstile();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { setDraft(JSON.parse(raw)); setStep(email ? 2 : 1); }
    } catch {}
  }, [email]);
  const save = (d: Draft | null) => { setDraft(d); try { d ? localStorage.setItem(KEY, JSON.stringify(d)) : localStorage.removeItem(KEY); } catch {} };

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null); setReading(true);
    const ticket = await requestUpload(file.type, file.size, ts.token);
    ts.reset();
    if (!ticket.ok) { setReading(false); return setError(ticket.error); }
    // straight from the phone to the private R2 bucket
    let put: Response | null = null;
    try { put = await fetch(ticket.url, { method: "PUT", body: file, headers: { "Content-Type": file.type } }); } catch {}
    if (!put?.ok) { setReading(false); return setError("Upload failed. Check your connection and try again."); }
    const res = await processUpload(ticket.key);
    setReading(false);
    if (!res.ok) return setError(res.error);
    const x = res.extracted;
    save({
      path: res.path, unread: !x, lowConfidence: !!x && x.confidence < 0.6,
      fields: { ...EMPTY, category: x?.category ?? "electric", biller_name: x?.biller_name ?? "", account_last4: x?.account_last4 ?? "", amount_dollars: x?.amount_due != null ? String(x.amount_due) : "", due_date: x?.due_date ?? "" },
    });
    setStep(1);
  }

  const set = (k: keyof Fields, v: string) => draft && save({ ...draft, fields: { ...draft.fields, [k]: v } });
  const f = draft?.fields;
  const ready = !!f && f.biller_name.trim() && Number(f.amount_dollars) >= 1 && Number(f.amount_dollars) <= 1500 && f.due_date && f.city.trim() && f.first_name.trim();

  function submit() {
    if (!draft) return;
    setError(null);
    start(async () => {
      const res = await submitBill({ ...draft.fields, image_path: draft.path });
      if (res.ok) { save(null); router.push(`/r/${res.token}`); } else setError(res.error);
    });
  }
  function link() {
    setError(null);
    start(async () => {
      const res = await sendMagicLink(mail, "/help");
      if (res.ok) setSent(true); else setError(res.error);
    });
  }

  return (
    <>
      <div className="steps" aria-label={`Step ${step + 1} of 3`}>{[0, 1, 2].map((i) => <i key={i} className={i <= step ? "on" : ""} />)}</div>

      {step === 0 && (
        <>
          <label className="drop">
            <input type="file" accept="image/*,application/pdf" capture="environment" aria-label="Upload or take a photo of your bill" disabled={reading || !ts.ready} onChange={(e) => onFile(e.target.files?.[0])} />
            <div className="serif" style={{ fontSize: 20, fontWeight: 700 }}>{reading ? "Reading your bill…" : "Snap or upload your bill"}</div>
            <p className="sub">{reading ? "Pulling out the biller, amount and due date." : "Photo or PDF. Rent, utilities, medical, childcare, phone or car."}</p>
          </label>
          <TurnstileBox t={ts} />
          {reading && <div className="skeleton" style={{ height: 8 }} role="status" aria-label="Reading" />}
          {error && <p className="err-text" role="alert">{error}</p>}
          <div className="panel" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            <b>The rules, up front.</b><br />One open request at a time. Bills from $1 to $1,500. The money is paid to the biller, never to you, so there&apos;s nothing to cash out and nothing to fake. Givers see your first name and city only.
          </div>
        </>
      )}

      {step === 1 && f && (
        <>
          <p className="sub" style={{ marginTop: 10 }}>{draft?.unread ? "We couldn't read the photo, so please fill these in by hand." : draft?.lowConfidence ? "We weren't sure about the photo. Please check every field." : "We filled this in from your photo. Fix anything that's wrong."}</p>
          <div className="panel">
            <Field label="Bill type"><select className="txt" value={f.category} onChange={(e) => set("category", e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Biller"><input className="txt" value={f.biller_name} maxLength={80} onChange={(e) => set("biller_name", e.target.value)} /></Field>
            <Field label="Last 4 of account number (optional)"><input className="num" inputMode="text" maxLength={4} value={f.account_last4} onChange={(e) => set("account_last4", e.target.value)} /></Field>
            <Field label="Amount due (USD, up to $1,500)"><input className="num" inputMode="decimal" value={f.amount_dollars} onChange={(e) => set("amount_dollars", e.target.value)} /></Field>
            <Field label="Due date"><input className="num" type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>
            <Field label="Your first name (shown to givers)"><input className="txt" value={f.first_name} maxLength={30} autoComplete="given-name" onChange={(e) => set("first_name", e.target.value)} /></Field>
            <Field label="Your city"><input className="txt" value={f.city} maxLength={40} autoComplete="address-level2" onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label={`A line for givers, optional (${140 - f.note.length} left)`}><textarea maxLength={140} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="Nobody is ranked by their story." /></Field>
          </div>
          <button className="btn solid block" disabled={!ready} onClick={() => setStep(2)}>Looks right</button>
          <button className="btn block" style={{ marginTop: 8, border: 0, textDecoration: "underline" }} onClick={() => { save(null); setStep(0); }}>Use a different photo</button>
        </>
      )}

      {step === 2 && f && (
        <>
          <div className="panel">
            <div className="row"><span>Biller</span><span>{f.biller_name}</span></div>
            <div className="row"><span>Amount</span><span>${Number(f.amount_dollars).toFixed(2)}</span></div>
            <div className="row"><span>Due</span><span>{f.due_date}</span></div>
            <div className="row"><span>Shown as</span><span>{f.first_name} · {f.city}</span></div>
          </div>
          {email ? (
            <>
              <p className="sub">Signed in as {email}. Our team will check your bill with the biller, usually within a day. We&apos;ll email you at each step.</p>
              <button className="btn go block" style={{ marginTop: 12 }} disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit for review"}</button>
              <button className="btn block" style={{ marginTop: 8, border: 0, textDecoration: "underline" }} onClick={() => setStep(1)}>Edit details</button>
            </>
          ) : sent ? (
            <div className="panel" role="status"><b>Check your inbox.</b><p className="sub">Open the link on this device and your request will be waiting here, ready to submit.</p></div>
          ) : (
            <>
              <p className="sub">Last step: where should we send status updates? We&apos;ll email you a sign-in link, no password.</p>
              <label className="lbl" style={{ display: "block" }}>Email<input className="txt" type="email" autoComplete="email" inputMode="email" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="you@example.com" /></label>
              <button className="btn solid block" style={{ marginTop: 12 }} disabled={busy || !mail.includes("@")} onClick={link}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
              <button className="btn block" style={{ marginTop: 8, border: 0, textDecoration: "underline" }} onClick={() => setStep(1)}>Edit details</button>
            </>
          )}
          {error && <p className="err-text" role="alert">{error}</p>}
        </>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="lbl" style={{ display: "block", textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{label}{children}</label>;
}
