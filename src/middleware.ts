import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export function middleware(request: NextRequest) {
  return updateSession(request);
}

// Only routes that need a session. The public deck stays fully static.
export const config = { matcher: ["/admin/:path*", "/receipts", "/help", "/auth/:path*"] };
