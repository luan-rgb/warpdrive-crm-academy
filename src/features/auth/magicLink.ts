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
import { magicLinkTokens, users } from "@/db/schema";
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
  // Google login has GOOGLE_WORKSPACE_DOMAIN (the `hd` claim) as a free membership gate: only
  // accounts in that Workspace ever get a token verified with it. Magic-link has nothing
  // equivalent, so this is injected to build one: a stranger who only knows a tenant's URL must
  // not be able to hand themselves an account in it just by owning an inbox.
  seedAdminEmail: string;
}

// Whether this tenant already recognises the email: either the seed admin (allowed even before
// their very first login, since no user row exists for them yet), or an existing user row
// (already bootstrapped, or an invited placeholder created by inviteUser). Anyone else is a
// stranger, not a student, regardless of how syntactically valid their email is.
async function isKnownToTenant(db: Db, email: string, seedAdminEmail: string): Promise<boolean> {
  if (seedAdminEmail.trim().toLowerCase() === email) return true;
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return existing.length > 0;
}

// Never mints a token for an email this tenant doesn't already recognise (see isKnownToTenant):
// unlike a SaaS with open signup, every tenant here belongs to exactly one paying student (plus
// whoever they've invited), so "does this account exist" is not a secret worth protecting at the
// cost of silently handing out access to anyone who asks.
export async function requestMagicLink(
  rawEmail: unknown,
  deps: Deps,
): Promise<Result<RequestMagicLinkOk, "invalid_email" | "not_a_student">> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return err("invalid_email");
  const email = parsed.data.trim().toLowerCase();

  deps.signal.throwIfAborted();
  if (!(await isKnownToTenant(deps.db, email, deps.seedAdminEmail))) return err("not_a_student");
  deps.signal.throwIfAborted();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

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

  // Defense in depth: requestMagicLink already refused to mint a token for an unrecognised
  // email, but this is the actual security boundary (the token is the bearer credential from
  // here on), so it re-checks rather than trusting that the earlier gate was the only path here.
  if (!(await isKnownToTenant(deps.db, claimed.email, deps.seedAdminEmail))) {
    return err("not_a_student");
  }

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
