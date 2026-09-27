import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { err, ok } from "@/types/result";
import { type ClientFactoryDeps, resolveMailClient } from "./clientFactory";
import { encryptToken } from "./crypto";
import { FakeGmailClient } from "./gmailFake";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];
const signal = (): AbortSignal => new AbortController().signal;

async function seed(
  db: TestDb,
  provider: string,
  extra: { refresh?: string; password?: string; imapSettings?: unknown } = {},
): Promise<string> {
  const u = (
    await db.execute(
      sql`INSERT INTO users (email, name, google_sub) VALUES ('a@x.com','A','sub-a') RETURNING id`,
    )
  ).rows[0] as { id: string };
  const refresh = extra.refresh !== undefined ? encryptToken(extra.refresh) : null;
  const pwd = extra.password !== undefined ? encryptToken(extra.password) : null;
  const settings = extra.imapSettings !== undefined ? JSON.stringify(extra.imapSettings) : null;
  const a = (
    await db.execute(
      sql`INSERT INTO email_accounts
            (user_id, email_address, provider, refresh_token_enc, imap_password_enc, imap_settings)
          VALUES (${u.id}, 'a@x.com', ${provider}, ${refresh}, ${pwd}, ${settings}::jsonb)
          RETURNING id`,
    )
  ).rows[0] as { id: string };
  return a.id;
}

function recordingDeps(): ClientFactoryDeps & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    refreshFor: (provider) => (rt) => {
      seen.push(`refresh:${provider}:${rt}`);
      return Promise.resolve(ok({ accessToken: `at-${provider}`, expiresIn: 3600 }));
    },
    gmail: (token) => {
      seen.push(`gmail:${token}`);
      return new FakeGmailClient();
    },
    outlook: (token) => {
      seen.push(`outlook:${token}`);
      return new FakeGmailClient();
    },
    imap: (cfg) => {
      seen.push(`imap:${cfg.imap.host}:${cfg.password}`);
      return new FakeGmailClient();
    },
  };
}

const IMAP_SETTINGS = {
  username: "a@x.com",
  imap: { host: "imap.x.com", port: 993, secure: true },
  smtp: { host: "smtp.x.com", port: 465, secure: true },
};

describe("resolveMailClient", () => {
  it("builds a Gmail client from a refreshed Google token", async () => {
    await withTestDb(async (db) => {
      const id = await seed(db, "gmail", { refresh: "rt-g" });
      const deps = recordingDeps();
      const r = await resolveMailClient(db, id, signal(), deps);
      expect(r.ok).toBe(true);
      expect(deps.seen).toEqual(["refresh:gmail:rt-g", "gmail:at-gmail"]);
    });
  });

  it("builds an Outlook client from a refreshed Microsoft token", async () => {
    await withTestDb(async (db) => {
      const id = await seed(db, "outlook", { refresh: "rt-o" });
      const deps = recordingDeps();
      const r = await resolveMailClient(db, id, signal(), deps);
      expect(r.ok).toBe(true);
      expect(deps.seen).toEqual(["refresh:outlook:rt-o", "outlook:at-outlook"]);
    });
  });

  it("builds an IMAP client with the decrypted password and stored settings", async () => {
    await withTestDb(async (db) => {
      const id = await seed(db, "imap", { password: "s3cret", imapSettings: IMAP_SETTINGS });
      const deps = recordingDeps();
      const r = await resolveMailClient(db, id, signal(), deps);
      expect(r.ok).toBe(true);
      expect(deps.seen).toEqual(["imap:imap.x.com:s3cret"]);
    });
  });

  it("returns E_MAIL_001 when an IMAP account has no stored credentials", async () => {
    await withTestDb(async (db) => {
      const id = await seed(db, "imap");
      const r = await resolveMailClient(db, id, signal(), recordingDeps());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.id).toBe("E_MAIL_001");
    });
  });

  it("propagates a refresh failure without building a client", async () => {
    await withTestDb(async (db) => {
      const id = await seed(db, "gmail", { refresh: "rt" });
      const deps = recordingDeps();
      deps.refreshFor = () => () => Promise.resolve(err(new AppError("E_GMAIL_001", "down", {})));
      const r = await resolveMailClient(db, id, signal(), deps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.id).toBe("E_GMAIL_001");
    });
  });

  it("returns E_MAIL_002 for an unknown account", async () => {
    await withTestDb(async (db) => {
      const r = await resolveMailClient(
        db,
        "00000000-0000-0000-0000-000000000000",
        signal(),
        recordingDeps(),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.id).toBe("E_MAIL_002");
    });
  });
});
