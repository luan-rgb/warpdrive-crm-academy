// @vitest-environment node
// Integration tests (real Postgres) for storing a Gmail/Outlook mailbox claimed from the relay.
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { decryptToken } from "./crypto";
import { bindOAuthMailbox } from "./relayBind";

const MAILBOX = {
  provider: "outlook" as const,
  email: "Aluno@Outlook.com",
  refreshToken: "rt-1",
  scopes: ["offline_access", "https://graph.microsoft.com/Mail.Send"],
};

it("stores the mailbox for the user with the refresh token encrypted by this tenant's key", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const r = await bindOAuthMailbox(db, user.id, MAILBOX);
    expect(r.ok).toBe(true);
    const row = (
      await db.execute(sql`
        SELECT provider, email_address, refresh_token_enc, status, scopes
        FROM email_accounts WHERE user_id = ${user.id}`)
    ).rows[0] as {
      provider: string;
      email_address: string;
      refresh_token_enc: Buffer;
      status: string;
      scopes: string[];
    };
    expect(row.provider).toBe("outlook");
    expect(row.email_address).toBe("aluno@outlook.com");
    expect(row.status).toBe("connected");
    expect(row.scopes).toEqual(MAILBOX.scopes);
    expect(decryptToken(row.refresh_token_enc)).toEqual({ ok: true, value: "rt-1" });
  });
});

it("refuses an address another user of the tenant already connected", async () => {
  await withTestDb(async (db) => {
    const first = await seedUser(db);
    const second = await seedUser(db);
    expect((await bindOAuthMailbox(db, first.id, MAILBOX)).ok).toBe(true);
    const r = await bindOAuthMailbox(db, second.id, MAILBOX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.id).toBe("E_GMAIL_006");
  });
});
