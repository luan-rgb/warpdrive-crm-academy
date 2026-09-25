/**
 * Passwordless sign-in: emails a one-time link instead of going through Google OAuth.
 *
 * Exists for deploys where Google sign-in isn't viable: a single Google OAuth client cannot
 * register a redirect_uri per subdomain (multi-tenant hosting, one subdomain per student), and
 * GOOGLE_WORKSPACE_DOMAIN blocks personal Gmail accounts anyway. See docs/deploy-multi-tenant.md.
 *
 * Reuses the exact same upsertUserOnLogin + createSession path as Google login and dev-login
 * (bootstrap.ts, devLogin.ts): the only difference is how the caller's email was verified. A
 * synthetic sub (magiclink-<email>) fills the same role Google's stable subject id normally does,
 * mirroring the dev-<email> pattern devLoginCore already uses for the same reason.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { magicLinkTokens } from "@/db/schema";
import { err, ok, type Result } from "@/types/result";
import type { VerifiedIdentity } from "./bootstrap";
import { upsertUserOnLogin } from "./bootstrap";
import { createSession } from "./session";

// Long enough to switch over to the inbox, short enough that a leaked link (forwarded, or
// fetched by a mail-scanner/link-preview bot before the real click) is only live briefly.
const TOKEN_TTL_MS = 15 * 60 * 1000;

const emailSchema = z.string().email().min(1).max(254);

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export interface RequestMagicLinkOk {
  email: string;
  token: string; // Raw value; caller embeds it in the emailed URL. Never stored raw (see below).
  expiresAt: Date;
}

export interface Deps {
  db: Db;
  signal: AbortSignal;
}

// Always succeeds for any syntactically valid email, whether or not an account exists yet for
// it (same shape as bootstrap's invite-placeholder flow). The caller (the route) must send an
// identical response either way: whether this address has an account is not this feature's to
// reveal (account enumeration).
export async function requestMagicLink(
  rawEmail: unknown,
  deps: Deps,
): Promise<Result<RequestMagicLinkOk, "invalid_email">> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return err("invalid_email");
  const email = parsed.data.trim().toLowerCase();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  deps.signal.throwIfAborted();
  await deps.db.insert(magicLinkTokens).values({ email, tokenHash: hashToken(token), expiresAt });
  deps.signal.throwIfAborted();

  return ok({ email, token, expiresAt });
}

export interface VerifyMagicLinkOk {
  userId: string;
  isAdmin: boolean;
  sid: string;
  expiresAt: Date;
}

// One-time use: the UPDATE that checks the token is still live (unused, unexpired) is the SAME
// statement that marks it used, so two concurrent verifies of one link (double-click, a link
// scanner following it before the real click) cannot both pass; the second sees usedAt already
// set and matches no row.
export async function verifyMagicLink(
  rawToken: unknown,
  deps: Deps,
): Promise<Result<VerifyMagicLinkOk, string>> {
  if (typeof rawToken !== "string" || rawToken.length === 0) return err("invalid_token");
  deps.signal.throwIfAborted();

  const [claimed] = await deps.db
    .update(magicLinkTokens)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(magicLinkTokens.tokenHash, hashToken(rawToken)),
        isNull(magicLinkTokens.usedAt),
        gt(magicLinkTokens.expiresAt, sql`now()`),
      ),
    )
    .returning({ email: magicLinkTokens.email });
  deps.signal.throwIfAborted();
  if (claimed === undefined) return err("invalid_token");

  const identity: VerifiedIdentity = {
    email: claimed.email,
    sub: `magiclink-${claimed.email}`,
    name: claimed.email,
    avatarUrl: null,
  };

  const upsertResult = await upsertUserOnLogin(deps.db, identity, deps.signal);
  if (!upsertResult.ok) return err(`upsert failed: ${upsertResult.error}`);

  const sessionResult = await createSession(deps.db, upsertResult.value.userId, deps.signal);
  if (!sessionResult.ok) return err(`session failed: ${sessionResult.error}`);

  return ok({
    userId: upsertResult.value.userId,
    isAdmin: upsertResult.value.isAdmin,
    sid: sessionResult.value.sid,
    expiresAt: sessionResult.value.expiresAt,
  });
}
