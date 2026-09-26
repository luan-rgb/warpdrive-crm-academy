/**
 * GET /auth/magic-link/verify: the link clicked from the sign-in email.
 *
 * Mirrors /auth/callback's cookie-setting shape exactly (same session cookie, same double-submit
 * CSRF cookie), so every downstream consumer of a session (middleware, server actions) is
 * unaware of which login method produced it.
 */

import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { CSRF_COOKIE, mintCsrfToken } from "@/features/auth/csrf";
import { LOGIN_RETURN_COOKIE, safeLoginReturnPath } from "@/features/auth/loginReturn";
import { verifyMagicLink } from "@/features/auth/magicLink";
import { SESSION_COOKIE, sessionCookieOptions } from "@/features/auth/session";
import { recordSecurityEvent } from "@/features/identity/securityAudit";

function loginError(reason: string): NextResponse {
  console.warn("[auth/magic-link/verify] rejected:", reason);
  void recordSecurityEvent(db, {
    actorId: null,
    targetType: "session",
    targetId: null,
    action: "auth.login_failed",
    detail: { method: "magic_link", reason },
  });
  return NextResponse.redirect(new URL("/login?error=auth_failed", env.BASE_URL));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const signal = AbortSignal.timeout(10_000);
  const token = req.nextUrl.searchParams.get("token");
  if (token === null) return loginError("missing token");

  const result = await verifyMagicLink(token, { db, signal, seedAdminEmail: env.SEED_ADMIN_EMAIL });
  if (!result.ok) return loginError(result.error);

  const jar = await cookies();
  const returnPath = safeLoginReturnPath(jar.get(LOGIN_RETURN_COOKIE)?.value);
  jar.delete(LOGIN_RETURN_COOKIE);

  const { sid, expiresAt } = result.value;
  await recordSecurityEvent(db, {
    actorId: result.value.userId,
    targetType: "session",
    targetId: null,
    action: "auth.login",
    detail: { method: "magic_link" },
  });
  const csrfToken = mintCsrfToken();
  const res = NextResponse.redirect(new URL(returnPath, env.BASE_URL));
  res.cookies.set(SESSION_COOKIE, sid, { ...sessionCookieOptions(), expires: expiresAt });
  res.cookies.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return res;
}
