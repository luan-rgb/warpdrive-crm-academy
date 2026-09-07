import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema/deals";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import {
  addDealProduct,
  dealProductsTotal,
  listDealProducts,
  removeDealProduct,
  updateDealProduct,
} from "./dealProductsRepo";
import { createProduct } from "./productsRepo";

const sig = () => new AbortController().signal;

// Mirrors notifications/router.test.ts's seedAllDeal: no dedicated factory for deals yet.
async function seedDeal(db: Db, ownerId: string): Promise<string> {
  const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
  const stage = stages[0];
  if (stage === undefined) throw new Error("seedDeal: no stage");
  const row = (
    await db.execute(sql`
      INSERT INTO deals (title, pipeline_id, stage_id, owner_id, visibility_level)
      VALUES ('Test Deal', ${pipeline.id}, ${stage.id}, ${ownerId}, 'all')
      RETURNING id
    `)
  ).rows[0] as { id: string } | undefined;
  if (row === undefined) throw new Error("seedDeal: insert returned no rows");
  return row.id;
}

it("adds a product to a deal, snapshotting the catalog name and price", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id);
    const product = await createProduct(
      db,
      { name: "Licenca Anual", sku: null, price: "1200.00", unit: "un", description: null },
      sig(),
    );
    if (product.ok === false) throw new Error("setup failed");

    const line = await addDealProduct(
      db,
      { dealId, productId: product.value.id, quantity: "2", discountPercent: "0" },
      sig(),
    );
    expect(line.ok).toBe(true);
    if (line.ok === true) {
      expect(line.value.name).toBe("Licenca Anual");
      expect(line.value.unitPrice).toBe("1200.00");
      expect(line.value.quantity).toBe("2.00");
    }

    const rows = await listDealProducts(db, dealId, sig());
    expect(rows).toHaveLength(1);
  });
});

it("computes the deal total across multiple line items with a discount", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id);
    const productA = await createProduct(
      db,
      { name: "Item A", sku: null, price: "100.00", unit: "un", description: null },
      sig(),
    );
    const productB = await createProduct(
      db,
      { name: "Item B", sku: null, price: "50.00", unit: "un", description: null },
      sig(),
    );
    if (productA.ok === false || productB.ok === false) throw new Error("setup failed");

    // 2 x 100.00 with 10% off = 180.00
    await addDealProduct(
      db,
      { dealId, productId: productA.value.id, quantity: "2", discountPercent: "10" },
      sig(),
    );
    // 3 x 50.00 no discount = 150.00
    await addDealProduct(
      db,
      { dealId, productId: productB.value.id, quantity: "3", discountPercent: "0" },
      sig(),
    );

    const total = await dealProductsTotal(db, dealId, sig());
    expect(total).toBe("330.00");
  });
});

it("updates and removes a line item", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id);
    const product = await createProduct(
      db,
      { name: "Item", sku: null, price: "20.00", unit: "un", description: null },
      sig(),
    );
    if (product.ok === false) throw new Error("setup failed");

    const line = await addDealProduct(
      db,
      { dealId, productId: product.value.id, quantity: "1", discountPercent: "0" },
      sig(),
    );
    if (line.ok === false) throw new Error("setup failed");

    const updated = await updateDealProduct(
      db,
      { id: line.value.id, quantity: "5", unitPrice: "18.00", discountPercent: "0" },
      sig(),
    );
    expect(updated.ok).toBe(true);
    if (updated.ok === true) expect(updated.value.quantity).toBe("5.00");

    const removed = await removeDealProduct(db, line.value.id, sig());
    expect(removed.ok).toBe(true);

    const rows = await listDealProducts(db, dealId, sig());
    expect(rows).toHaveLength(0);
  });
});

async function dealValue(db: Db, dealId: string): Promise<string | null> {
  const [row] = await db.select({ value: deals.value }).from(deals).where(eq(deals.id, dealId));
  return row?.value ?? null;
}

it("syncs deals.value to the line-item total when a product is added", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id);
    const product = await createProduct(
      db,
      { name: "Item", sku: null, price: "100.00", unit: "un", description: null },
      sig(),
    );
    if (product.ok === false) throw new Error("setup failed");

    await addDealProduct(
      db,
      { dealId, productId: product.value.id, quantity: "3", discountPercent: "0" },
      sig(),
    );

    expect(await dealValue(db, dealId)).toBe("300.00");
  });
});

it("re-syncs deals.value when a line item is edited", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id);
    const product = await createProduct(
      db,
      { name: "Item", sku: null, price: "100.00", unit: "un", description: null },
      sig(),
    );
    if (product.ok === false) throw new Error("setup failed");

    const line = await addDealProduct(
      db,
      { dealId, productId: product.value.id, quantity: "1", discountPercent: "0" },
      sig(),
    );
    if (line.ok === false) throw new Error("setup failed");
    expect(await dealValue(db, dealId)).toBe("100.00");

    await updateDealProduct(
      db,
      { id: line.value.id, quantity: "4", unitPrice: "100.00", discountPercent: "0" },
      sig(),
    );
    expect(await dealValue(db, dealId)).toBe("400.00");
  });
});

it("leaves deals.value at its last computed figure once the last line is removed", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id);
    const product = await createProduct(
      db,
      { name: "Item", sku: null, price: "100.00", unit: "un", description: null },
      sig(),
    );
    if (product.ok === false) throw new Error("setup failed");

    const line = await addDealProduct(
      db,
      { dealId, productId: product.value.id, quantity: "1", discountPercent: "0" },
      sig(),
    );
    if (line.ok === false) throw new Error("setup failed");
    expect(await dealValue(db, dealId)).toBe("100.00");

    await removeDealProduct(db, line.value.id, sig());

    // Not reset to null/0: the deal is simply free to be edited manually again from here.
    expect(await dealValue(db, dealId)).toBe("100.00");
  });
});

it("returns E_PRODUCT_002 when adding a product that does not exist to a deal", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id);
    const result = await addDealProduct(
      db,
      {
        dealId,
        productId: "00000000-0000-0000-0000-000000000000",
        quantity: "1",
        discountPercent: "0",
      },
      sig(),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.id).toBe("E_PRODUCT_002");
  });
});
