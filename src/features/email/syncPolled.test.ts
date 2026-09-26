/**
 * syncPolled.test.ts: TDD tests for syncPolledMailbox (Outlook and IMAP, which have no history cursor).
 *
 * Test plan:
 * (a) applies every message listMessages returns, via the normal applyMessageIds path (real
 *     rows land in email_threads/email_messages, same as syncMailbox's own path).
 * (b) re-running with the SAME messages is a no-op (applyMessageIds' own idempotency, which this
 *     function leans on instead of tracking a cursor): no duplicate rows, no error.
 * (c) a disconnected account short-circuits to applied:0, same shape as syncMailbox.
 * (d) last_sync_at is stamped on success.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { FakeGmailClient } from "./gmailFake";
import type { GmailMessage } from "./gmailSchemas";
import { syncPolledMailbox } from "./sync";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];
const newSignal = (): AbortSignal => new AbortController().signal;

function msg(id: string, threadId: string): GmailMessage {
  return {
    id,
    threadId,
    labelIds: [],
    snippet: "hi",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "student@example.com" },
        { name: "To", value: "o@gunsnation.com" },
        { name: "Subject", value: "Hello" },
      ],
      body: { data: Buffer.from("body").toString("base64url") },
    },
  };
}

async function seedAccount(db: TestDb, status = "connected"): Promise<string> {
  const u = (
    await db.execute(
      sql`INSERT INTO users (email, name, google_sub) VALUES ('o@gunsnation.com','O','sub-o') RETURNING id`,
    )
  ).rows[0] as { id: string };
  const a = (
    await db.execute(
      sql`INSERT INTO email_accounts (user_id, email_address, provider, status)
          VALUES (${u.id},'o@gunsnation.com','outlook',${status}) RETURNING id`,
    )
  ).rows[0] as { id: string };
  return a.id;
}

async function messageCount(db: TestDb, acctId: string): Promise<number> {
  const r = await db.execute(
    sql`SELECT count(*)::int AS n FROM email_messages WHERE account_id=${acctId}`,
  );
  return (r.rows[0] as { n: number }).n;
}

describe("syncPolledMailbox", () => {
  it("applies every message listMessages returns", async () => {
    await withTestDb(async (db) => {
      const acctId = await seedAccount(db);
      const fake = new FakeGmailClient();
      fake.listResults = [{ messages: [{ id: "m1", threadId: "t1" }] }];
      fake.messages.set("m1", msg("m1", "t1"));

      const r = await syncPolledMailbox(db, {
        accountId: acctId,
        gmail: fake,
        signal: newSignal(),
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.applied).toBe(1);
      expect(await messageCount(db, acctId)).toBe(1);
    });
  });

  it("re-running with the same messages is a no-op (idempotent, no duplicate rows)", async () => {
    await withTestDb(async (db) => {
      const acctId = await seedAccount(db);
      const fake = new FakeGmailClient();
      fake.listResults = [{ messages: [{ id: "m1", threadId: "t1" }] }];
      fake.messages.set("m1", msg("m1", "t1"));

      await syncPolledMailbox(db, { accountId: acctId, gmail: fake, signal: newSignal() });
      const second = await syncPolledMailbox(db, {
        accountId: acctId,
        gmail: fake,
        signal: newSignal(),
      });
      expect(second.ok).toBe(true);
      expect(await messageCount(db, acctId)).toBe(1);
    });
  });

  it("a disconnected account short-circuits to applied:0", async () => {
    await withTestDb(async (db) => {
      const acctId = await seedAccount(db, "disconnected");
      const fake = new FakeGmailClient();
      fake.listResults = [{ messages: [{ id: "m1", threadId: "t1" }] }];

      const r = await syncPolledMailbox(db, {
        accountId: acctId,
        gmail: fake,
        signal: newSignal(),
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.applied).toBe(0);
      expect(fake.calls.some((c) => c.method === "listMessages")).toBe(false);
    });
  });

  it("stamps last_sync_at on success", async () => {
    await withTestDb(async (db) => {
      const acctId = await seedAccount(db);
      const fake = new FakeGmailClient();
      fake.listResults = [{ messages: [] }];

      await syncPolledMailbox(db, { accountId: acctId, gmail: fake, signal: newSignal() });
      const row = (
        await db.execute(sql`SELECT last_sync_at FROM email_accounts WHERE id=${acctId}`)
      ).rows[0] as { last_sync_at: Date | null };
      expect(row.last_sync_at).not.toBeNull();
    });
  });

  it("does not re-fetch messages it already stored (each tick lists the same recent mail)", async () => {
    await withTestDb(async (db) => {
      const acctId = await seedAccount(db);
      const fake = new FakeGmailClient();
      fake.listResults = [{ messages: [{ id: "m1", threadId: "t1" }] }];
      fake.messages.set("m1", msg("m1", "t1"));

      await syncPolledMailbox(db, { accountId: acctId, gmail: fake, signal: newSignal() });
      fake.calls = [];
      await syncPolledMailbox(db, { accountId: acctId, gmail: fake, signal: newSignal() });
      expect(fake.calls.filter((c) => c.method === "getMessage")).toEqual([]);
    });
  });

  it("hides a conversation whose every message landed in Trash or Junk", async () => {
    await withTestDb(async (db) => {
      const acctId = await seedAccount(db);
      const fake = new FakeGmailClient();
      fake.listResults = [{ messages: [{ id: "m1", threadId: "t1" }] }];
      fake.messages.set("m1", { ...msg("m1", "t1"), labelIds: ["SPAM"] });
      fake.threads.set("t1", { id: "t1", messages: [{ id: "m1", labelIds: ["SPAM"] }] });

      await syncPolledMailbox(db, { accountId: acctId, gmail: fake, signal: newSignal() });
      const row = (
        await db.execute(
          sql`SELECT trashed_at FROM email_threads WHERE account_id=${acctId} AND gmail_thread_id='t1'`,
        )
      ).rows[0] as { trashed_at: Date | null };
      expect(row.trashed_at).not.toBeNull();
    });
  });
});
