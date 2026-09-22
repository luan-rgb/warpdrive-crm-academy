/**
 * magicLink.test.ts: TDD tests for requestMagicLink / verifyMagicLink.
 *
 * Test plan:
 * (a) requestMagicLink: valid email -> stores a hashed token, never the raw value.
 * (b) requestMagicLink: invalid email -> err("invalid_email"), no DB write.
 * (c) verifyMagicLink: fresh token -> upserts user, returns session (mirrors devLoginCore).
 * (d) verifyMagicLink: unknown/garbage token -> err.
 * (e) verifyMagicLink: expired token -> err, no session created.
 * (f) verifyMagicLink: already-used token -> err on the second attempt (single use).
 * (g) verifyMagicLink: synthetic sub is prefixed magiclink- (mirrors dev- in devLoginCore).
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { magicLinkTokens, sessions, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { requestMagicLink, verifyMagicLink } from "./magicLink";

let h: TestDb;
const SIG = () => AbortSignal.timeout(8000);

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
  test("valid email: stores a hashed token, never the raw value", async () => {
    const result = await requestMagicLink("student@example.com", { db: h.db, signal: SIG() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const rows = await h.db.select().from(magicLinkTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe("student@example.com");
    expect(rows[0]!.tokenHash).not.toBe(result.value.token);
    expect(rows[0]!.usedAt).toBeNull();
  });

  test("normalises email to lowercase", async () => {
    await requestMagicLink("Student@Example.COM", { db: h.db, signal: SIG() });
    const rows = await h.db.select().from(magicLinkTokens);
    expect(rows[0]!.email).toBe("student@example.com");
  });

  test("invalid email: err, no DB write", async () => {
    const result = await requestMagicLink("not-an-email", { db: h.db, signal: SIG() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_email");
    const rows = await h.db.select().from(magicLinkTokens);
    expect(rows).toHaveLength(0);
  });
});

describe("verifyMagicLink", () => {
  test("fresh token: upserts user and returns a session", async () => {
    const requested = await requestMagicLink("student@example.com", { db: h.db, signal: SIG() });
    if (!requested.ok) throw new Error("expected ok");

    const result = await verifyMagicLink(requested.value.token, { db: h.db, signal: SIG() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.sid).toBeTruthy();

    const dbUsers = await h.db.select().from(users);
    expect(dbUsers).toHaveLength(1);
    expect(dbUsers[0]!.email).toBe("student@example.com");
    expect(dbUsers[0]!.googleSub).toBe("magiclink-student@example.com");

    const dbSessions = await h.db.select().from(sessions);
    expect(dbSessions).toHaveLength(1);
    expect(dbSessions[0]!.userId).toBe(result.value.userId);
  });

  test("unknown token: err, no session created", async () => {
    const result = await verifyMagicLink("not-a-real-token", { db: h.db, signal: SIG() });
    expect(result.ok).toBe(false);
    const dbSessions = await h.db.select().from(sessions);
    expect(dbSessions).toHaveLength(0);
  });

  test("expired token: err, no session created", async () => {
    const requested = await requestMagicLink("student@example.com", { db: h.db, signal: SIG() });
    if (!requested.ok) throw new Error("expected ok");
    await h.db
      .update(magicLinkTokens)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(magicLinkTokens.email, "student@example.com"));

    const result = await verifyMagicLink(requested.value.token, { db: h.db, signal: SIG() });
    expect(result.ok).toBe(false);
    const dbSessions = await h.db.select().from(sessions);
    expect(dbSessions).toHaveLength(0);
  });

  test("already-used token: succeeds once, fails on replay", async () => {
    const requested = await requestMagicLink("student@example.com", { db: h.db, signal: SIG() });
    if (!requested.ok) throw new Error("expected ok");

    const first = await verifyMagicLink(requested.value.token, { db: h.db, signal: SIG() });
    expect(first.ok).toBe(true);

    const second = await verifyMagicLink(requested.value.token, { db: h.db, signal: SIG() });
    expect(second.ok).toBe(false);

    // Still exactly one session: the replay must not have minted a second one.
    const dbSessions = await h.db.select().from(sessions);
    expect(dbSessions).toHaveLength(1);
  });

  test("second login for the same email reuses the same user (idempotent)", async () => {
    const r1 = await requestMagicLink("student@example.com", { db: h.db, signal: SIG() });
    if (!r1.ok) throw new Error("expected ok");
    await verifyMagicLink(r1.value.token, { db: h.db, signal: SIG() });

    const r2 = await requestMagicLink("student@example.com", { db: h.db, signal: SIG() });
    if (!r2.ok) throw new Error("expected ok");
    await verifyMagicLink(r2.value.token, { db: h.db, signal: SIG() });

    const dbUsers = await h.db.select().from(users);
    expect(dbUsers).toHaveLength(1);
  });
});
