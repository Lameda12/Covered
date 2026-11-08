"use client";
import { useCallback, useEffect, useRef, useState } from "react";

declare global { interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id?: string) => void } } }
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Managed, mostly-invisible challenge. `token` is single-use: call `reset()` after each server call. */
export function useTurnstile() {
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef<string | undefined>(undefined);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !ref.current || !window.turnstile || id.current) return;
      id.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY, appearance: "interaction-only", callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(null), "error-callback": () => setToken(null),
      });
    };
    if (window.turnstile) mount();
    else {
      let s = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
      if (!s) { s = document.createElement("script"); s.src = SRC; s.async = true; document.head.appendChild(s); }
      s.addEventListener("load", mount);
    }
    return () => { cancelled = true; if (id.current) window.turnstile?.remove(id.current); id.current = undefined; };
  }, []);

  const reset = useCallback(() => { setToken(null); if (id.current) window.turnstile?.reset(id.current); }, []);
  return { ref, token, reset, enabled: !!SITE_KEY, ready: !SITE_KEY || !!token };
}

export function TurnstileBox({ t }: { t: ReturnType<typeof useTurnstile> }) {
  return t.enabled ? <div ref={t.ref} style={{ marginTop: 8, display: "flex", justifyContent: "center" }} /> : null;
}
