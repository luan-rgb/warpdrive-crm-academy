import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { archiveProduct, createProduct, listProducts, updateProduct } from "./productsRepo";

const sig = () => new AbortController().signal;

it("creates a product and lists it back", async () => {
  await withTestDb(async (db) => {
    const created = await createProduct(
      db,
      {
        name: "Consultoria CRM",
        sku: "CONS-01",
        price: "1500.00",
        unit: "hora",
        description: null,
      },
      sig(),
    );
    expect(created.ok).toBe(true);
    const rows = await listProducts(db, {}, sig());
    expect(rows.map((r) => r.name)).toContain("Consultoria CRM");
  });
});

it("rejects a second non-archived product with the same sku", async () => {
  await withTestDb(async (db) => {
    await createProduct(
      db,
      { name: "Plano Basico", sku: "PLANO-1", price: "99.00", unit: "un", description: null },
      sig(),
    );
    const second = await createProduct(
      db,
      {
        name: "Plano Basico Duplicado",
        sku: "PLANO-1",
        price: "199.00",
        unit: "un",
        description: null,
      },
      sig(),
    );
    expect(second.ok).toBe(false);
    if (second.ok === false) expect(second.error.id).toBe("E_PRODUCT_003");
  });
});

it("archiving a product removes it from the default (non-archived) list", async () => {
  await withTestDb(async (db) => {
    const created = await createProduct(
      db,
      { name: "Produto Temporario", sku: null, price: "10.00", unit: "un", description: null },
      sig(),
    );
    if (created.ok === false) throw new Error("setup failed");

    const archived = await archiveProduct(db, created.value.id, sig());
    expect(archived.ok).toBe(true);

    const activeOnly = await listProducts(db, {}, sig());
    expect(activeOnly.find((p) => p.id === created.value.id)).toBeUndefined();

    const withArchived = await listProducts(db, { includeArchived: true }, sig());
    expect(withArchived.find((p) => p.id === created.value.id)).toBeDefined();
  });
});

it("updates a product's price and name", async () => {
  await withTestDb(async (db) => {
    const created = await createProduct(
      db,
      { name: "Antigo Nome", sku: null, price: "50.00", unit: "un", description: null },
      sig(),
    );
    if (created.ok === false) throw new Error("setup failed");

    const updated = await updateProduct(
      db,
      {
        id: created.value.id,
        name: "Novo Nome",
        sku: null,
        price: "75.00",
        unit: "un",
        description: "Atualizado",
      },
      sig(),
    );
    expect(updated.ok).toBe(true);
    if (updated.ok === true) {
      expect(updated.value.name).toBe("Novo Nome");
      expect(updated.value.price).toBe("75.00");
    }
  });
});

it("returns E_PRODUCT_002 when updating a product that does not exist", async () => {
  await withTestDb(async (db) => {
    const result = await updateProduct(
      db,
      {
        id: "00000000-0000-0000-0000-000000000000",
        name: "Fantasma",
        sku: null,
        price: "1.00",
        unit: "un",
        description: null,
      },
      sig(),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.id).toBe("E_PRODUCT_002");
  });
});
