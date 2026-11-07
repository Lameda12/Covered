"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { parseSweep, previewSweep, startSweepCheckout } from "@/app/actions/sweep";
import { dollars } from "@/lib/money";
import { CATEGORIES, type SweepFilters } from "@/lib/validation";

type Preview = Extract<Awaited<ReturnType<typeof previewSweep>>, { ok: true }>;
const BUDGETS = [100000, 1000000, 5000000, 10000000];
const EXAMPLE = "heat bills in Winnipeg under $400, due this week, $10k";

export function SweepBuilder({ cities }: { cities: string[] }) {
  const [text, setText] = useState("");
  const [f, setF] = useState<SweepFilters | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [parsing, startParse] = useTransition();
  const [paying, startPay] = useTransition();
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!f) return;
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await previewSweep(f);
      if (id !== seq.current) return;
      setLoading(false);
      if (r.ok) { setPreview(r); setError(null); } else setError(r.error);
    }, 250);
    return () => clearTimeout(t);
  }, [f]);

  const upd = (p: Partial<SweepFilters>) => setF((cur) => (cur ? { ...cur, ...p } : cur));
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function build() {
    setError(null); setNote(null);
    startParse(async () => {
      const r = await parseSweep(text);
      if (r.ok) { setF(r.filters); if (!r.usedAi) setNote("Quick read (AI is offline). Check the chips."); } else setError(r.error);
    });
  }
  function pay() {
    if (!f) return;
    setError(null);
    startPay(async () => { const r = await startSweepCheckout(f); if (r.ok) window.location.assign(r.url); else setError(r.error); });
  }

  return (
    <>
      <div className="panel">
        <label className="lbl lbl-tight" style={{ display: "block", textTransform: "none", letterSpacing: 0, fontSize: 12 }}>Say what you want covered
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} maxLength={300} />
        </label>
        <div className="chips"><button className="chip ghost" onClick={() => setText(EXAMPLE)}>Try an example</button></div>
        <button className="btn solid block" disabled={parsing || text.trim().length < 3} onClick={build}>{parsing ? "Reading…" : "Build my sweep"}</button>
        {error && !f && <p className="err-text" role="alert">{error}</p>}
      </div>

      {f && (
        <>
          <div className="panel">
            <div className="lbl lbl-tight">Bill types <b>{f.categories.length ? f.categories.length + " selected" : "All"}</b></div>
            <div className="chips">{CATEGORIES.map((c) => <button key={c} className="chip" aria-pressed={f.categories.includes(c)} onClick={() => upd({ categories: toggle(f.categories, c) })}>{c}</button>)}</div>
            {cities.length > 0 && <>
              <div className="lbl">Cities <b>{f.cities.length ? f.cities.length + " selected" : "All"}</b></div>
              <div className="chips">{[...new Set([...cities, ...f.cities])].map((c) => <button key={c} className="chip" aria-pressed={f.cities.some((x) => x.toLowerCase() === c.toLowerCase())} onClick={() => upd({ cities: f.cities.some((x) => x.toLowerCase() === c.toLowerCase()) ? f.cities.filter((x) => x.toLowerCase() !== c.toLowerCase()) : [...f.cities, c] })}>{c}</button>)}</div>
            </>}
            <div className="lbl"><label htmlFor="mx">Max per bill</label><b>{f.max_bill_cents ? dollars(f.max_bill_cents, 0) : "No limit"}</b></div>
            <input id="mx" type="range" min={50} max={1500} step={50} value={f.max_bill_cents ? f.max_bill_cents / 100 : 1500} onChange={(e) => upd({ max_bill_cents: +e.target.value >= 1500 ? undefined : +e.target.value * 100 })} />
            <div className="lbl"><label htmlFor="dd">Due within</label><b>{f.due_within_days ? `${f.due_within_days} day${f.due_within_days > 1 ? "s" : ""}` : "Any time"}</b></div>
            <input id="dd" type="range" min={1} max={31} value={f.due_within_days ?? 31} onChange={(e) => upd({ due_within_days: +e.target.value >= 31 ? undefined : +e.target.value })} />
            <div className="lbl">Budget <b>{dollars(f.budget_cents, 0)}</b></div>
            <div className="chips">{BUDGETS.map((n) => <button key={n} className="chip" aria-pressed={f.budget_cents === n} onClick={() => upd({ budget_cents: n })}>{n >= 1e6 ? "$" + n / 1e5 + "k" : "$" + n / 100}</button>)}</div>
            {/* TODO(v2): recurring sweeps ("repeat on the 1st of every month") */}
          </div>

          <div className="receipt" aria-busy={loading}>
            <div className="lbl lbl-tight">Sweep preview</div>
            {!preview ? <div className="skeleton" style={{ height: 120, marginTop: 10 }} role="status" aria-label="Loading preview" /> : (
              <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity .2s" }}>
                <div className="row" style={{ marginTop: 8 }}><span>Bills matching rules</span><span>{preview.matching}</span></div>
                <div className="row"><span>Total still owed</span><span>{dollars(preview.owed)}</span></div>
                <div className="rule" />
                <div className="row"><span>Your sweep pays</span><span><b>{preview.bills} bills</b></span></div>
                <div className="row"><span>Households</span><span>{preview.households}</span></div>
                <div className="row"><span>Refunded if unspent</span><span>{dollars(preview.leftover)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "12px 0 8px" }}><span className="lbl lbl-tight">Total</span><span className="big">{dollars(preview.spend)}</span></div>
                {Object.entries(preview.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
                  <div className="catbar" key={c}><span>{c.toUpperCase()}</span><span className="t"><i style={{ width: `${(v / Math.max(...Object.values(preview.byCategory))) * 100}%` }} /></span><span style={{ textAlign: "right" }}>{dollars(v, 0)}</span></div>
                ))}
                {preview.bills < preview.matching && preview.matching > 0 && <p className="sub" style={{ fontSize: 12 }}>{preview.matching - preview.bills} more bills fit your rules. Raise the budget to clear them all.</p>}
              </div>
            )}
          </div>
          {note && <p className="sub">{note}</p>}
          {error && <p className="err-text" role="alert">{error}</p>}
          <button className="btn go block" disabled={paying || !preview || preview.bills === 0} onClick={pay}>
            {paying ? "Opening checkout…" : preview && preview.bills === 0 ? "Nothing matches these rules" : `Pay ${dollars(f.budget_cents, 0)}`}
          </button>
          <p className="sub" style={{ textAlign: "center", fontSize: 12 }}>You&apos;re charged your full budget once. Whatever isn&apos;t spent on bills is refunded automatically.</p>
        </>
      )}
    </>
  );
}
