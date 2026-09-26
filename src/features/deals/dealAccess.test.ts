// @vitest-environment node
// Integration tests (real Postgres): records hanging off a deal (products, invoices) are only
// reachable by someone who can see the deal, and only changeable by someone who can edit it.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { HydratedActor } from "@/server/hydrateActor";
import { createCaller } from "@/server/trpc/root";
import { authorizeDealAccess } from "./dealAccess";

const sig = () => new AbortController().signal;

function actor(id: string, flags: PermissionFlagKey[]): HydratedActor {
  return {
    id,
    type: "regular",
    isActive: true,
    name: "U",
    email: "u@example.com",
    avatarUrl: null,
    flags: new Set(flags),
    groupIds: new Set(),
  };
}

async function seedPrivateDealWithInvoice(db: Db, ownerId: string) {
  const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
  const deal = (
    await db.execute(sql`
      INSERT INTO deals (title, pipeline_id, stage_id, owner_id, visibility_level, status)
      VALUES ('Privado', ${pipeline.id}, ${stages[0]?.id}, ${ownerId}, 'owner', 'open')
      RETURNING id`)
  ).rows[0] as { id: string };
  const product = (
    await db.execute(sql`
      INSERT INTO products (name, price, unit) VALUES ('Item', '10', 'un') RETURNING id`)
  ).rows[0] as { id: string };
  const line = (
    await db.execute(sql`
      INSERT INTO deal_products (deal_id, product_id, name, quantity, unit_price)
      VALUES (${deal.id}, ${product.id}, 'Item', '1', '10') RETURNING id`)
  ).rows[0] as { id: string };
  const invoice = (
    await db.execute(sql`
      INSERT INTO invoices (deal_id, issue_date, total) VALUES (${deal.id}, '2026-09-26', '10')
      RETURNING id`)
  ).rows[0] as { id: string };
  return { dealId: deal.id, lineId: line.id, invoiceId: invoice.id };
}

describe("authorizeDealAccess", () => {
  it("hides another user's private deal and everything attached to it", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const other = await seedUser(db);
      const ids = await seedPrivateDealWithInvoice(db, owner.id);
      const intruder = actor(other.id, ["deal.edit_any"]);

      for (const target of [
        { dealId: ids.dealId },
        { dealProductId: ids.lineId },
        { invoiceId: ids.invoiceId },
      ]) {
        const r = await authorizeDealAccess(db, intruder, target, "read", sig());
        expect(r.ok).toBe(false);
      }
    });
  });

  it("lets the owner read and edit, and refuses edit without the edit permission", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const ids = await seedPrivateDealWithInvoice(db, owner.id);

      const reader = actor(owner.id, []);
      const read = await authorizeDealAccess(
        db,
        reader,
        { invoiceId: ids.invoiceId },
        "read",
        sig(),
      );
      expect(read).toEqual({ ok: true, value: { dealId: ids.dealId } });
      const denied = await authorizeDealAccess(
        db,
        reader,
        { dealProductId: ids.lineId },
        "edit",
        sig(),
      );
      expect(denied.ok).toBe(false);

      const editor = actor(owner.id, ["deal.edit_own"]);
      const edit = await authorizeDealAccess(
        db,
        editor,
        { dealProductId: ids.lineId },
        "edit",
        sig(),
      );
      expect(edit).toEqual({ ok: true, value: { dealId: ids.dealId } });
    });
  });

  it("reports an unknown id as not found", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db, { isAdmin: true });
      const r = await authorizeDealAccess(
        db,
        { ...actor(user.id, []), type: "admin" },
        { invoiceId: "00000000-0000-0000-0000-000000000000" },
        "read",
        sig(),
      );
      expect(r.ok).toBe(false);
    });
  });
});

describe("routers use it", () => {
  it("invoices.get, invoices.listForDeal and products.byDeal refuse another user's private deal", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const other = await seedUser(db);
      const ids = await seedPrivateDealWithInvoice(db, owner.id);
      const caller = createCaller({
        db,
        session: { userId: other.id, sessionId: "s" },
        actor: actor(other.id, ["deal.edit_any"]),
      });
      await expect(caller.invoices.get({ id: ids.invoiceId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.invoices.listForDeal({ dealId: ids.dealId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.products.byDeal({ dealId: ids.dealId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
