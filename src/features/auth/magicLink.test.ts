/**
 * magicLink.test.ts: TDD tests for requestMagicLink / verifyMagicLink.
 *
 * Test plan:
 * (a) requestMagicLink: valid email -> stores a hashed token, never the raw value.
 * (b) requestMagicLink: invalid email -> err("invalid_email"), no DB write.
 * (c) requestMagicLink: unknown email (not the seed admin, no existing user row) ->
 *     err("not_a_student"), no DB write, no token minted. Magic-link has no Google Workspace `hd`
 *     claim to gate on, so this is the ONLY thing stopping a stranger who knows a tenant's URL
 *     from getting themselves an account in it.
 * (d) requestMagicLink: the seed admin's very first-ever login (no user row exists yet) -> ok.
 * (e) requestMagicLink: an existing user's email (already bootstrapped, or an invited
 *     placeholder) -> ok.
 * (f) verifyMagicLink: fresh token -> upserts user, returns session (mirrors devLoginCore).
 * (g) verifyMagicLink: unknown/garbage token -> err.
 * (h) verifyMagicLink: expired token -> err, no session created.
 * (i) verifyMagicLink: already-used token -> err on the second attempt (single use).
 * (j) verifyMagicLink: synthetic sub is prefixed magiclink- (mirrors dev- in devLoginCore).
 * (k) verifyMagicLink: defense in depth, refuses even a genuine unexpired token if the email
 *     is no longer known (not just requestMagicLink's problem to catch).
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { magicLinkTokens, sessions, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { requestMagicLink, verifyMagicLink } from "./magicLink";

let h: TestDb;
const SIG = () => AbortSignal.timeout(8000);
const SEED_ADMIN = "admin@example.com";

function deps() {
  return { db: h.db, signal: SIG(), seedAdminEmail: SEED_ADMIN };
}

beforeAll(async () => {
  h = await makeTestDb();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.db.execute(
    sql`TRUNCATE visibility_group_members, visibility_groups, sessions, magic_link_tokens, users, permission_sets, settings, audit_events RESTART IDENTITY CASCADE`,
  );
});

describe("requestMagicLink", () => {
  test("seed admin's first-ever login (no user row exists yet): ok", async () => {
    const result = await requestMagicLink(SEED_ADMIN, deps());
    expect(result.ok).toBe(true);
  });

  test("valid email matching the seed admin: stores a hashed token, never the raw value", async () => {
    const result = await requestMagicLink(SEED_ADMIN, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const rows = await h.db.select().from(magicLinkTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe(SEED_ADMIN);
    expect(rows[0]!.tokenHash).not.toBe(result.value.token);
    expect(rows[0]!.usedAt).toBeNull();
  });

  test("normalises email to lowercase", async () => {
    await requestMagicLink("Admin@Example.COM", deps());
    const rows = await h.db.select().from(magicLinkTokens);
    expect(rows[0]!.email).toBe(SEED_ADMIN);
  });

  test("invalid email: err, no DB write", async () => {
    const result = await requestMagicLink("not-an-email", deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_email");
    const rows = await h.db.select().from(magicLinkTokens);
    expect(rows).toHaveLength(0);
  });

  test("unknown email (not seed admin, no existing user): err('not_a_student'), no DB write", async () => {
    const result = await requestMagicLink("stranger@example.com", deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_a_student");
    const rows = await h.db.select().from(magicLinkTokens);
    expect(rows).toHaveLength(0);
  });

  test("an existing (already-bootstrapped) user's email: ok, even if not the seed admin", async () => {
    const first = await requestMagicLink(SEED_ADMIN, deps());
    if (!first.ok) throw new Error("expected ok");
    await verifyMagicLink(first.value.token, deps());

    // Simulate an admin having invited a teammate: a placeholder row with no google_sub yet.
    await h.db.insert(users).values({
      email: "teammate@example.com",
      name: "Teammate",
      googleSub: null,
      invitedAt: new Date(),
    });

    const result = await requestMagicLink("teammate@example.com", deps());
    expect(result.ok).toBe(true);
  });
});

describe("verifyMagicLink", () => {
  test("fresh token: upserts user and returns a session", async () => {
    const requested = await requestMagicLink(SEED_ADMIN, deps());
    if (!requested.ok) throw new Error("expected ok");

    const result = await verifyMagicLink(requested.value.token, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.sid).toBeTruthy();

    const dbUsers = await h.db.select().from(users);
    expect(dbUsers).toHaveLength(1);
    expect(dbUsers[0]!.email).toBe(SEED_ADMIN);
    expect(dbUsers[0]!.googleSub).toBe(`magiclink-${SEED_ADMIN}`);

    const dbSessions = await h.db.select().from(sessions);
    expect(dbSessions).toHaveLength(1);
    expect(dbSessions[0]!.userId).toBe(result.value.userId);
  });

  test("unknown token: err, no session created", async () => {
    const result = await verifyMagicLink("not-a-real-token", deps());
    expect(result.ok).toBe(false);
    const dbSessions = await h.db.select().from(sessions);
    expect(dbSessions).toHaveLength(0);
  });

  test("expired token: err, no session created", async () => {
    const requested = await requestMagicLink(SEED_ADMIN, deps());
    if (!requested.ok) throw new Error("expected ok");
    await h.db
      .update(magicLinkTokens)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(magicLinkTokens.email, SEED_ADMIN));

    const result = await verifyMagicLink(requested.value.token, deps());
    expect(result.ok).toBe(false);
    const dbSessions = await h.db.select().from(sessions);
    expect(dbSessions).toHaveLength(0);
  });

  test("already-used token: succeeds once, fails on replay", async () => {
    const requested = await requestMagicLink(SEED_ADMIN, deps());
    if (!requested.ok) throw new Error("expected ok");

    const first = await verifyMagicLink(requested.value.token, deps());
    expect(first.ok).toBe(true);

    const second = await verifyMagicLink(requested.value.token, deps());
    expect(second.ok).toBe(false);

    // Still exactly one session: the replay must not have minted a second one.
    const dbSessions = await h.db.select().from(sessions);
    expect(dbSessions).toHaveLength(1);
  });

  test("second login for the same email reuses the same user (idempotent)", async () => {
    const r1 = await requestMagicLink(SEED_ADMIN, deps());
    if (!r1.ok) throw new Error("expected ok");
    await verifyMagicLink(r1.value.token, deps());

    const r2 = await requestMagicLink(SEED_ADMIN, deps());
    if (!r2.ok) throw new Error("expected ok");
    await verifyMagicLink(r2.value.token, deps());

    const dbUsers = await h.db.select().from(users);
    expect(dbUsers).toHaveLength(1);
  });

  test("defense in depth: a genuine token for an email no longer known is refused", async () => {
    const requested = await requestMagicLink(SEED_ADMIN, deps());
    if (!requested.ok) throw new Error("expected ok");

    // Simulate the email having become "unknown" between request and verify (e.g. a
    // differently-configured seedAdminEmail deps at verify time): the token itself is genuine,
    // unexpired, and unused, but requestMagicLink's gate is not the only line of defense.
    const result = await verifyMagicLink(requested.value.token, {
      db: h.db,
      signal: SIG(),
      seedAdminEmail: "someone-else@example.com",
    });
    expect(result.ok).toBe(false);
    const dbSessions = await h.db.select().from(sessions);
    expect(dbSessions).toHaveLength(0);
  });
});
