import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/redirect";
import { supabaseServer } from "@/lib/supabase/server";

/** PKCE landing for sign-in links requested through the site (help step 3, /receipts). */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  if (code) {
    const { error } = await (await supabaseServer()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, req.url));
  }
  return NextResponse.redirect(new URL("/receipts?error=link", req.url));
}
