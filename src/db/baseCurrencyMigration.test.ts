// Data test for 0085: tenants must run in reais. The column default was 'USD'; any settings row
// still on USD (never chosen by anyone: the base currency is read-only in the UI) moves to BRL.
import { rmSync } from "node:fs";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { applyMigrations } from "./migrate";
import { migrationsUpTo } from "./testing/migrationsUpTo";

let container: StartedPostgreSqlContainer;
let pool: Pool;
let partial: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  partial = migrationsUpTo("0085");
}, 120_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
  rmSync(partial, { recursive: true, force: true });
});

test("a settings row on the old USD default becomes BRL, and new rows default to BRL", async () => {
  const db = drizzle(pool);
  expect((await applyMigrations(db, undefined, partial)).ok).toBe(true);
  await db.execute(sql`DELETE FROM settings`);
  await db.execute(sql`INSERT INTO settings (id) VALUES (true)`);
  const before = await db.execute(sql`SELECT base_currency FROM settings`);
  expect(before.rows[0]).toEqual({ base_currency: "USD" });

  expect((await applyMigrations(db)).ok).toBe(true);

  const after = await db.execute(sql`SELECT base_currency FROM settings`);
  expect(after.rows[0]).toEqual({ base_currency: "BRL" });
  const def = await db.execute(sql`
    SELECT column_default FROM information_schema.columns
    WHERE table_name='settings' AND column_name='base_currency'`);
  expect(String((def.rows[0] as { column_default: string }).column_default)).toContain("BRL");
});
