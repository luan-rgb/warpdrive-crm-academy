/**
 * POST /auth/magic-link/request: sends a one-time sign-in link to the given email.
 *
 * Deliberately DOES disclose "you're not a recognised member of this CRM" (unlike a typical
 * SaaS's account-enumeration-safe "check your inbox either way"): each tenant here belongs to
 * exactly one paying student (plus whoever they've invited, see isKnownToTenant in magicLink.ts),
 * so silently emailing a link to any address that asks would let a stranger self-register into
 * someone else's CRM just by knowing its URL. A clear rejection is the whole point.
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

  const result = await requestMagicLink(rawEmail, {
    db,
    signal,
    seedAdminEmail: env.SEED_ADMIN_EMAIL,
  });
  if (!result.ok) {
    return NextResponse.redirect(new URL(`/login?error=${result.error}`, env.BASE_URL));
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
