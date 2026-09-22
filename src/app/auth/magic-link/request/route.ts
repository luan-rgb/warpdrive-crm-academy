/**
 * POST /auth/magic-link/request: sends a one-time sign-in link to the given email.
 *
 * Always redirects to the same /login?sent=1 whether or not an account exists for that address
 * (never disclose account existence), UNLESS the email is not even syntactically valid, which
 * is a format problem the visitor can fix and isn't an enumeration leak either way.
 */

import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { requestMagicLink } from "@/features/auth/magicLink";
import { sendMagicLinkEmail } from "@/features/auth/magicLinkEmail";
import { checkRateLimit, tooManyRequestsResponse } from "@/server/rateLimitGuard";

export async function POST(req: NextRequest): Promise<Response> {
  const limit = checkRateLimit("authMagicLinkRequest", req.headers);
  if (!limit.allowed) return tooManyRequestsResponse(limit);

  const signal = AbortSignal.timeout(10_000);
  const form = await req.formData().catch(() => null);
  const rawEmail = form?.get("email");

  const result = await requestMagicLink(rawEmail, { db, signal });
  if (!result.ok) {
    return NextResponse.redirect(new URL("/login?error=invalid_email", env.BASE_URL));
  }

  const verifyUrl = new URL(
    `/auth/magic-link/verify?token=${result.value.token}`,
    env.BASE_URL,
  ).toString();
  const config = { apiKey: env.RESEND_API_KEY, fromEmail: env.MAGIC_LINK_FROM_EMAIL };
  const sendResult = await sendMagicLinkEmail(
    { to: result.value.email, verifyUrl },
    { config, signal },
  );
  if (!sendResult.ok) {
    console.error("[auth/magic-link/request] send failed:", sendResult.error);
  }

  return NextResponse.redirect(new URL("/login?sent=1", env.BASE_URL));
}
