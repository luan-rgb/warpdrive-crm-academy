/**
 * /auth/logout: revokes the current session and clears auth cookies.
 *
 * Security invariants:
 * 1. Loads the live session from the wd_sid cookie; if none exists, still clears
 *    cookies and redirects (idempotent, no 500 on stale requests).
 * 2. Revokes ALL sessions for the user (matches offboarding-revokes-all semantic).
 * 3. Clears both wd_sid and wd_csrf cookies on the redirect response.
 * 4. Infra errors are caught; always redirect to /login (no 500 leak).
 * 5. Only a same-site POST carrying the CSRF token logs out. A GET never does: SameSite=Lax
 *    cookies ride along on top-level navigations, so any link or page elsewhere could otherwise
 *    sign the user out of every session.
 */

import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { CSRF_COOKIE, validateCsrf } from "@/features/auth/csrf";
import { logoutCore } from "@/features/auth/logout";
import { SESSION_COOKIE } from "@/features/auth/session";
import { recordSecurityEvent } from "@/features/identity/securityAudit";
import { safeErrorSummary } from "@/lib/safeError";

const CLEARED_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 0,
} as const;

function redirectToLogin(): NextResponse {
  const res = NextResponse.redirect(new URL("/login", env.BASE_URL));
  res.cookies.set(SESSION_COOKIE, "", CLEARED_COOKIE_OPTIONS);
  res.cookies.set(CSRF_COOKIE, "", { ...CLEARED_COOKIE_OPTIONS, httpOnly: false });
  return res;
}

// A stale bookmark or old link to /auth/logout just goes home; it never ends a session.
export function GET(): NextResponse {
  return NextResponse.redirect(new URL("/", env.BASE_URL));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const signal = AbortSignal.timeout(10_000);

  try {
    const jar = await cookies();
    const form = await req.formData().catch(() => null);
    const token = form?.get("csrf");
    const csrf = validateCsrf({
      cookieToken: jar.get(CSRF_COOKIE)?.value ?? null,
      headerToken: typeof token === "string" ? token : null,
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
      secFetchSite: req.headers.get("sec-fetch-site"),
    });
    if (!csrf.ok) return NextResponse.redirect(new URL("/", env.BASE_URL));

    const sid = jar.get(SESSION_COOKIE)?.value ?? null;
    const out = await logoutCore({ db, sid, signal });
    if (out.ok && out.value.userId !== null) {
      await recordSecurityEvent(db, {
        actorId: out.value.userId,
        targetType: "session",
        targetId: null,
        action: "auth.logout",
      });
    }

    return redirectToLogin();
  } catch (e) {
    console.error("[auth/logout] infra error during logout:", safeErrorSummary(e));
    return redirectToLogin();
  }
}
