// Security events (sign-in, sign-out, OAuth grants, mailbox connections, exports) in audit_events,
// against real Postgres.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { TestDb } from "@/test/db";
import { makeTestDb } from "@/test/db";
import { purgeOldAuditEvents, recordSecurityEvent } from "./securityAudit";

describe("security audit events", () => {
  let tdb: TestDb;
  beforeAll(async () => {
    tdb = await makeTestDb();
  }, 60_000);
  afterAll(async () => {
    await tdb.close();
  });

  test("records each security event kind", async () => {
    for (const [targetType, action] of [
      ["session", "auth.login"],
      ["session", "auth.login_failed"],
      ["session", "auth.logout"],
      ["oauth_client", "oauth.grant"],
      ["oauth_client", "oauth.revoke"],
      ["mailbox", "mailbox.connect"],
      ["export", "data.export"],
    ] as const) {
      await recordSecurityEvent(tdb.db, { actorId: null, targetType, targetId: null, action });
    }
    const rows = (
      await tdb.db.execute(sql`SELECT target_type, action FROM audit_events ORDER BY created_at`)
    ).rows;
    expect(rows).toHaveLength(7);
  });

  test("never throws: a failed audit write must not break sign-in or the action it records", async () => {
    await expect(
      recordSecurityEvent(tdb.db, {
        // Not a user id: the foreign key rejects it, and the helper swallows that.
        actorId: "00000000-0000-0000-0000-000000000000",
        targetType: "session",
        targetId: null,
        action: "auth.login",
      }),
    ).resolves.toBeUndefined();
  });

  test("purges events older than the retention window and keeps recent ones", async () => {
    await tdb.db.execute(sql`DELETE FROM audit_events`);
    await tdb.db.execute(sql`
      INSERT INTO audit_events (target_type, action, created_at) VALUES
        ('session', 'auth.login', now() - interval '400 days'),
        ('session', 'auth.login', now() - interval '10 days')`);
    const removed = await purgeOldAuditEvents(tdb.db, AbortSignal.timeout(5_000));
    expect(removed).toBe(1);
    const left = (await tdb.db.execute(sql`SELECT count(*)::int AS n FROM audit_events`)).rows[0];
    expect(left).toEqual({ n: 1 });
  });
});
