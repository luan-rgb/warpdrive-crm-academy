import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { addDealProduct } from "@/features/products/dealProductsRepo";
import { createProduct } from "@/features/products/productsRepo";
import {
  addInvoiceLineItem,
  createInvoiceFromDeal,
  deleteInvoice,
  getInvoice,
  listInvoicesForDeal,
  removeInvoiceLineItem,
  updateInvoiceLineItem,
  updateInvoiceStatus,
} from "./invoicesRepo";

const sig = () => new AbortController().signal;

async function seedDeal(
  db: Db,
  ownerId: string,
  status: "open" | "won" | "lost" = "won",
): Promise<string> {
  const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
  const stage = stages[0];
  if (stage === undefined) throw new Error("seedDeal: no stage");
  const row = (
    await db.execute(sql`
      INSERT INTO deals (title, pipeline_id, stage_id, owner_id, visibility_level, status)
      VALUES ('Test Deal', ${pipeline.id}, ${stage.id}, ${ownerId}, 'all', ${status})
      RETURNING id
    `)
  ).rows[0] as { id: string } | undefined;
  if (row === undefined) throw new Error("seedDeal: insert returned no rows");
  return row.id;
}

async function seedProductOnDeal(db: Db, dealId: string, price: string, quantity: string) {
  const product = await createProduct(
    db,
    { name: "Item", sku: null, price, unit: "un", description: null },
    sig(),
  );
  if (product.ok === false) throw new Error("setup failed");
  await addDealProduct(
    db,
    { dealId, productId: product.value.id, quantity, discountPercent: "0" },
    sig(),
  );
}

it("creates an invoice from a won deal's current products, snapshotting them", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "100.00", "2");
    await seedProductOnDeal(db, dealId, "50.00", "1");

    const result = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.invoice.total).toBe("250.00");
      expect(result.value.invoice.status).toBe("issued");
      expect(result.value.lines).toHaveLength(2);
    }
  });
});

it("creates an invoice from an open (not-yet-won) deal too", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "open");
    await seedProductOnDeal(db, dealId, "100.00", "1");

    const result = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    expect(result.ok).toBe(true);
  });
});

it("rejects invoicing a deal with no products", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");

    const result = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.id).toBe("E_INVOICE_004");
  });
});

it("keeps the invoice line items unchanged after the deal's own products are edited", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
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

    const created = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    if (created.ok === false) throw new Error("setup failed");

    // Now change the deal's own line item price after the invoice was issued.
    await db.execute(
      sql`UPDATE deal_products SET unit_price = '999.00' WHERE id = ${line.value.id}`,
    );

    const fetched = await getInvoice(db, created.value.invoice.id, sig());
    expect(fetched.ok).toBe(true);
    if (fetched.ok === true) {
      expect(fetched.value.invoice.total).toBe("100.00");
      expect(fetched.value.lines[0]?.unitPrice).toBe("100.00");
    }
  });
});

it("computes subtotal/tax/total for a tax-exclusive invoice", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "100.00", "2"); // base 200.00

    const result = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
        lineTaxRates: ["10"],
      },
      sig(),
    );
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.invoice.subtotal).toBe("200.00");
      expect(result.value.invoice.taxTotal).toBe("20.00");
      expect(result.value.invoice.total).toBe("220.00");
      expect(result.value.lines[0]?.taxRatePercent).toBe("10.00");
    }
  });
});

it("computes subtotal/tax/total for a tax-inclusive invoice", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "110.00", "1"); // base 110.00, 10% inclusive

    const result = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "inclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
        lineTaxRates: ["10"],
      },
      sig(),
    );
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.invoice.total).toBe("110.00");
      expect(result.value.invoice.taxTotal).toBe("10.00");
      expect(result.value.invoice.subtotal).toBe("100.00");
    }
  });
});

it("defaults to no tax when taxMode is 'none', ignoring any tax rate", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "50.00", "1");

    const result = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "none",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
        lineTaxRates: ["10"],
      },
      sig(),
    );
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.invoice.taxTotal).toBe("0.00");
      expect(result.value.invoice.subtotal).toBe("50.00");
      expect(result.value.invoice.total).toBe("50.00");
    }
  });
});

it("defaults missing lineTaxRates entries to 0, so existing minimal callers keep working", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "10.00", "1");

    const result = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.invoice.taxMode).toBe("exclusive");
      expect(result.value.invoice.taxTotal).toBe("0.00");
      expect(result.value.lines[0]?.taxRatePercent).toBe("0.00");
    }
  });
});

async function seedOrg(db: Db, ownerId: string, name: string): Promise<string> {
  const row = (
    await db.execute(sql`
      INSERT INTO organizations (name, owner_id, visibility_level)
      VALUES (${name}, ${ownerId}, 'all')
      RETURNING id
    `)
  ).rows[0] as { id: string } | undefined;
  if (row === undefined) throw new Error("seedOrg: insert returned no rows");
  return row.id;
}

it("snapshots the bill-to name at creation time, unaffected by a later org rename", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const orgId = await seedOrg(db, user.id, "Original Org Name");
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const dealRow = (
      await db.execute(sql`
        INSERT INTO deals (title, pipeline_id, stage_id, owner_id, visibility_level, status, org_id)
        VALUES ('Test Deal', ${pipeline.id}, ${stage.id}, ${user.id}, 'all', 'won', ${orgId})
        RETURNING id
      `)
    ).rows[0] as { id: string } | undefined;
    if (dealRow === undefined) throw new Error("no deal");
    await seedProductOnDeal(db, dealRow.id, "10.00", "1");

    const created = await createInvoiceFromDeal(
      db,
      {
        dealId: dealRow.id,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.invoice.billToName).toBe("Original Org Name");

    await db.execute(sql`UPDATE organizations SET name = 'Renamed Org' WHERE id = ${orgId}`);

    const reread = await getInvoice(db, created.value.invoice.id, sig());
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(reread.value.invoice.billToName).toBe("Original Org Name");
    }
  });
});

it("recomputes tax when a line item's tax rate is updated", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "100.00", "1");
    const created = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
        lineTaxRates: ["0"],
      },
      sig(),
    );
    if (!created.ok) throw new Error("setup failed");
    const line = created.value.lines[0];
    if (line === undefined) throw new Error("no line");

    const updated = await updateInvoiceLineItem(
      db,
      {
        id: line.id,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        taxRatePercent: "20",
      },
      sig(),
    );
    expect(updated.ok).toBe(true);

    const reread = await getInvoice(db, created.value.invoice.id, sig());
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(reread.value.invoice.taxTotal).toBe("20.00");
      expect(reread.value.invoice.total).toBe("120.00");
    }
  });
});

it("lists invoices for a deal, newest first", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "10.00", "1");

    await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-01",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-15",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );

    const rows = await listInvoicesForDeal(db, dealId, sig());
    expect(rows).toHaveLength(2);
  });
});

it("transitions an invoice from issued to paid", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "10.00", "1");
    const created = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    if (created.ok === false) throw new Error("setup failed");

    const updated = await updateInvoiceStatus(
      db,
      { id: created.value.invoice.id, status: "paid" },
      sig(),
    );
    expect(updated.ok).toBe(true);
    if (updated.ok === true) expect(updated.value.status).toBe("paid");
  });
});

it("rejects a status change on an already-canceled invoice", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "10.00", "1");
    const created = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    if (created.ok === false) throw new Error("setup failed");
    await updateInvoiceStatus(db, { id: created.value.invoice.id, status: "canceled" }, sig());

    const result = await updateInvoiceStatus(
      db,
      { id: created.value.invoice.id, status: "paid" },
      sig(),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.id).toBe("E_INVOICE_005");
  });
});

it("deletes an invoice and its line items", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "10.00", "1");
    const created = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    if (created.ok === false) throw new Error("setup failed");

    const result = await deleteInvoice(db, created.value.invoice.id, sig());
    expect(result.ok).toBe(true);

    const fetched = await getInvoice(db, created.value.invoice.id, sig());
    expect(fetched.ok).toBe(false);

    const rows = await listInvoicesForDeal(db, dealId, sig());
    expect(rows).toHaveLength(0);
  });
});

it("returns E_INVOICE_006 when deleting an invoice that does not exist", async () => {
  await withTestDb(async (db) => {
    const result = await deleteInvoice(db, "00000000-0000-0000-0000-000000000000", sig());
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.id).toBe("E_INVOICE_006");
  });
});

it("adds a line item to an issued invoice and recomputes the total", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "100.00", "1");
    const created = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    if (created.ok === false) throw new Error("setup failed");
    expect(created.value.invoice.total).toBe("100.00");

    const product = await createProduct(
      db,
      { name: "Extra service", sku: null, price: "50.00", unit: "un", description: null },
      sig(),
    );
    if (product.ok === false) throw new Error("setup failed");

    const added = await addInvoiceLineItem(
      db,
      {
        invoiceId: created.value.invoice.id,
        productId: product.value.id,
        quantity: "1",
        discountPercent: "0",
        taxRatePercent: "0",
      },
      sig(),
    );
    expect(added.ok).toBe(true);

    const fetched = await getInvoice(db, created.value.invoice.id, sig());
    if (fetched.ok === false) throw new Error("setup failed");
    expect(fetched.value.invoice.total).toBe("150.00");
    expect(fetched.value.lines).toHaveLength(2);
  });
});

it("updates and removes a line item on an issued invoice, recomputing the total each time", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "100.00", "1");
    const created = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    if (created.ok === false) throw new Error("setup failed");
    const lineId = created.value.lines[0]?.id;
    if (lineId === undefined) throw new Error("setup failed");

    const updated = await updateInvoiceLineItem(
      db,
      { id: lineId, quantity: "3", unitPrice: "100.00", discountPercent: "0", taxRatePercent: "0" },
      sig(),
    );
    expect(updated.ok).toBe(true);
    const afterUpdate = await getInvoice(db, created.value.invoice.id, sig());
    if (afterUpdate.ok === false) throw new Error("setup failed");
    expect(afterUpdate.value.invoice.total).toBe("300.00");

    const removed = await removeInvoiceLineItem(db, lineId, sig());
    expect(removed.ok).toBe(true);
    const afterRemove = await getInvoice(db, created.value.invoice.id, sig());
    if (afterRemove.ok === false) throw new Error("setup failed");
    expect(afterRemove.value.invoice.total).toBe("0.00");
    expect(afterRemove.value.lines).toHaveLength(0);
  });
});

it("rejects a line-item change on a paid invoice", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "100.00", "1");
    const created = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
      },
      sig(),
    );
    if (created.ok === false) throw new Error("setup failed");
    await updateInvoiceStatus(db, { id: created.value.invoice.id, status: "paid" }, sig());

    const product = await createProduct(
      db,
      { name: "Extra", sku: null, price: "10.00", unit: "un", description: null },
      sig(),
    );
    if (product.ok === false) throw new Error("setup failed");

    const result = await addInvoiceLineItem(
      db,
      {
        invoiceId: created.value.invoice.id,
        productId: product.value.id,
        quantity: "1",
        discountPercent: "0",
        taxRatePercent: "0",
      },
      sig(),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.id).toBe("E_INVOICE_007");
  });
});
