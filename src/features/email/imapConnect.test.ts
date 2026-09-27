import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { err, ok } from "@/types/result";
import { decryptToken, encryptToken } from "./crypto";
import { bindImapAccount, connectImapMailbox } from "./imapConnect";
import type { ImapSettings } from "./imapSettings";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];

const SETTINGS: ImapSettings = {
  username: "luan@provedor.com.br",
  imap: { host: "imap.provedor.com.br", port: 993, secure: true },
  smtp: { host: "smtp.provedor.com.br", port: 465, secure: true },
};

async function seedUser(db: TestDb, email: string): Promise<string> {
  const r = await db.execute(
    sql`INSERT INTO users (email, name, google_sub) VALUES (${email}, 'U', ${`sub-${email}`}) RETURNING id`,
  );
  return (r.rows[0] as { id: string }).id;
}

async function account(db: TestDb, userId: string) {
  const r = await db.execute(sql`
    SELECT provider, email_address, imap_settings, imap_password_enc, refresh_token_enc, status,
           last_history_id, last_error_id
    FROM email_accounts WHERE user_id=${userId}`);
  return r.rows[0] as {
    provider: string;
    email_address: string;
    imap_settings: unknown;
    imap_password_enc: Buffer | null;
    refresh_token_enc: Buffer | null;
    status: string;
    last_history_id: string | null;
    last_error_id: string | null;
  };
}

describe("bindImapAccount", () => {
  it("stores the settings and the password encrypted, never in clear text", async () => {
    await withTestDb(async (db) => {
      const userId = await seedUser(db, "u@x.com");
      const r = await bindImapAccount(db, {
        userId,
        emailAddress: "Luan@Provedor.com.br",
        settings: SETTINGS,
        password: "senha-de-app",
      });
      expect(r.ok).toBe(true);
      const row = await account(db, userId);
      expect(row.provider).toBe("imap");
      expect(row.email_address).toBe("luan@provedor.com.br");
      expect(row.imap_settings).toEqual(SETTINGS);
      expect(row.status).toBe("connected");
      expect(row.imap_password_enc?.toString("utf8")).not.toContain("senha-de-app");
      const dec = row.imap_password_enc === null ? null : decryptToken(row.imap_password_enc);
      expect(dec).toEqual({ ok: true, value: "senha-de-app" });
    });
  });

  it("replacing an OAuth mailbox clears the old token and the Gmail history cursor", async () => {
    await withTestDb(async (db) => {
      const userId = await seedUser(db, "u@x.com");
      await db.execute(sql`
        INSERT INTO email_accounts (user_id, email_address, provider, refresh_token_enc, last_history_id, status, last_error_id)
        VALUES (${userId}, 'old@gmail.com', 'gmail', ${encryptToken("rt")}, '123', 'disconnected', 'E_GMAIL_002')`);
      const r = await bindImapAccount(db, {
        userId,
        emailAddress: "luan@provedor.com.br",
        settings: SETTINGS,
        password: "p",
      });
      expect(r.ok).toBe(true);
      const row = await account(db, userId);
      expect(row.provider).toBe("imap");
      expect(row.refresh_token_enc).toBeNull();
      expect(row.last_history_id).toBeNull();
      expect(row.last_error_id).toBeNull();
      expect(row.status).toBe("connected");
    });
  });

  it("an address already connected by another user is reported, not overwritten", async () => {
    await withTestDb(async (db) => {
      const a = await seedUser(db, "a@x.com");
      const b = await seedUser(db, "b@x.com");
      await bindImapAccount(db, {
        userId: a,
        emailAddress: "same@x.com",
        settings: SETTINGS,
        password: "p",
      });
      const r = await bindImapAccount(db, {
        userId: b,
        emailAddress: "same@x.com",
        settings: SETTINGS,
        password: "p",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.id).toBe("E_GMAIL_006");
    });
  });
});

describe("connectImapMailbox", () => {
  const input = {
    emailAddress: "luan@provedor.com.br",
    password: "senha",
    ...SETTINGS,
  };

  it("rejects malformed input before touching the network", async () => {
    await withTestDb(async (db) => {
      const userId = await seedUser(db, "u@x.com");
      let verified = false;
      const r = await connectImapMailbox(db, {
        userId,
        rawInput: { ...input, imap: { host: "", port: 99999, secure: true } },
        deps: {
          verify: () => {
            verified = true;
            return Promise.resolve(ok(undefined));
          },
          enqueue: () => Promise.resolve(),
        },
        signal: new AbortController().signal,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.id).toBe("E_MAIL_006");
      expect(verified).toBe(false);
    });
  });

  it("does not save a mailbox whose login fails", async () => {
    await withTestDb(async (db) => {
      const userId = await seedUser(db, "u@x.com");
      const r = await connectImapMailbox(db, {
        userId,
        rawInput: input,
        deps: {
          verify: () => Promise.resolve(err(new AppError("E_MAIL_005", "no", { stage: "imap" }))),
          enqueue: () => Promise.resolve(),
        },
        signal: new AbortController().signal,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.id).toBe("E_MAIL_005");
      expect(await account(db, userId)).toBeUndefined();
    });
  });

  it("verifies with the typed password, saves, and starts the first sync", async () => {
    await withTestDb(async (db) => {
      const userId = await seedUser(db, "u@x.com");
      const seen: string[] = [];
      const r = await connectImapMailbox(db, {
        userId,
        rawInput: input,
        deps: {
          verify: (cfg) => {
            seen.push(`verify:${cfg.password}:${cfg.imap.host}`);
            return Promise.resolve(ok(undefined));
          },
          enqueue: (accountId) => {
            seen.push(`enqueue:${accountId}`);
            return Promise.resolve();
          },
        },
        signal: new AbortController().signal,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(seen).toEqual(["verify:senha:imap.provedor.com.br", `enqueue:${r.value.accountId}`]);
      expect((await account(db, userId)).provider).toBe("imap");
    });
  });
});
