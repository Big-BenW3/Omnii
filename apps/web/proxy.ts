import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Server-to-server endpoints authenticated by their own signatures/secrets. */
const ORIGIN_EXEMPT = ["/api/v1/webhooks/", "/api/v1/cron/"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedOrigins(req: NextRequest) {
  const out = new Set<string>([req.nextUrl.origin]);
  if (process.env.APP_BASE_URL) out.add(new URL(process.env.APP_BASE_URL).origin);
  return out;
}

/**
 * CSRF defense in depth (spec 10.7): cookie-authenticated API mutations must come
 * from a Concord origin. Session cookies are also SameSite=Strict. Auth itself is
 * enforced per route by requireSession(); the proxy does no session lookups.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (SAFE_METHODS.has(req.method) || ORIGIN_EXEMPT.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins(req).has(origin)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Cross-origin request rejected" } },
      { status: 403 }
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/v1/:path*" };
