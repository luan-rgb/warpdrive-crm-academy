// Data test for the migration that retires the Nylas integration: mailboxes connected through
// Nylas cannot be carried over (a Nylas grant is not a Google/Microsoft refresh token), so they
// must end up disconnected with an explanatory error id, keeping their row and synced mail.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { applyMigrations } from "./migrate";

let container: StartedPostgreSqlContainer;
let pool: Pool;
let partial: string;

// A copy of drizzle/ whose journal stops right before the Nylas retirement migration.
function migrationsUpTo(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wd-mig-"));
  cpSync("drizzle", dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  const stop = journal.entries.findIndex((e) => e.tag.startsWith(tag));
  journal.entries = journal.entries.slice(0, stop);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  partial = migrationsUpTo("0084");
}, 120_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
  rmSync(partial, { recursive: true, force: true });
});

test("Nylas mailboxes become disconnected with E_MAIL_008, keeping their mail", async () => {
  const db = drizzle(pool);
  expect((await applyMigrations(db, undefined, partial)).ok).toBe(true);

  const users = await db.execute(sql`
    INSERT INTO users (email, name, google_sub) VALUES ('n@x.com','N','s-n'), ('g@x.com','G','s-g')
    RETURNING id`);
  const [nylasUser, gmailUser] = users.rows as { id: string }[];
  const acct = await db.execute(sql`
    INSERT INTO email_accounts (user_id, email_address, nylas_grant_id, status)
    VALUES (${nylasUser?.id}, 'n@x.com', 'grant-1', 'connected') RETURNING id`);
  const nylasAccount = (acct.rows[0] as { id: string }).id;
  await db.execute(sql`
    INSERT INTO email_accounts (user_id, email_address, refresh_token_enc, status)
    VALUES (${gmailUser?.id}, 'g@x.com', decode('00','hex'), 'connected')`);
  await db.execute(sql`
    INSERT INTO email_threads (gmail_thread_id, account_id, subject) VALUES ('t1', ${nylasAccount}, 'oi')`);

  expect((await applyMigrations(db)).ok).toBe(true);

  const rows = await db.execute(sql`
    SELECT email_address, status, last_error_id FROM email_accounts ORDER BY email_address`);
  expect(rows.rows).toEqual([
    { email_address: "g@x.com", status: "connected", last_error_id: null },
    { email_address: "n@x.com", status: "disconnected", last_error_id: "E_MAIL_008" },
  ]);
  const threads = await db.execute(sql`SELECT count(*)::int AS n FROM email_threads`);
  expect(threads.rows[0]).toEqual({ n: 1 });
  const column = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name='email_accounts' AND column_name='nylas_grant_id'`);
  expect(column.rows).toHaveLength(0);
});
