import { asc, eq, max } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { type DealProduct, dealProducts } from "@/db/schema/dealProducts";
import { deals } from "@/db/schema/deals";
import { products } from "@/db/schema/products";
import { err, ok, type Result } from "@/types/result";
import type { AddDealProductInput, UpdateDealProductInput } from "./productSchema";

export async function listDealProducts(
  db: Db,
  dealId: string,
  signal: AbortSignal,
): Promise<DealProduct[]> {
  signal.throwIfAborted();
  return db
    .select()
    .from(dealProducts)
    .where(eq(dealProducts.dealId, dealId))
    .orderBy(asc(dealProducts.position));
}

// Sum of quantity * unitPrice * (1 - discountPercent/100) across a deal's line items, at
// numeric(14,2) precision. Returned as a decimal string, same convention as deals.value, so the
// caller can write it straight back without a float round trip.
export async function dealProductsTotal(
  db: Db,
  dealId: string,
  signal: AbortSignal,
): Promise<string> {
  const lines = await listDealProducts(db, dealId, signal);
  const total = lines.reduce((sum, line) => {
    const lineTotal =
      Number(line.quantity) * Number(line.unitPrice) * (1 - Number(line.discountPercent) / 100);
    return sum + lineTotal;
  }, 0);
  return total.toFixed(2);
}

// Keeps deals.value equal to the line-item total while any line exists, the same rule Pipedrive
// applies: a deal with products priced is worth what its products add up to, not a number typed
// separately that could drift from them. Once the last line is removed this is simply not called
// again, so the deal's value stays at its last computed figure and is free to edit manually, per
// the existing deal-update path (no separate "unlock" step needed).
async function syncDealValue(db: Db, dealId: string, signal: AbortSignal): Promise<void> {
  const lines = await listDealProducts(db, dealId, signal);
  if (lines.length === 0) return;
  const total = await dealProductsTotal(db, dealId, signal);
  await db.update(deals).set({ value: total }).where(eq(deals.id, dealId));
}

export async function addDealProduct(
  db: Db,
  input: AddDealProductInput,
  signal: AbortSignal,
): Promise<Result<DealProduct, AppError>> {
  signal.throwIfAborted();
  const [product] = await db.select().from(products).where(eq(products.id, input.productId));
  if (product === undefined) {
    return err(
      new AppError(ERROR_IDS.PRODUCT_NOT_FOUND, "product not found", { id: input.productId }),
    );
  }
  const [positionRow] = await db
    .select({ maxPosition: max(dealProducts.position) })
    .from(dealProducts)
    .where(eq(dealProducts.dealId, input.dealId));
  const maxPosition = positionRow?.maxPosition ?? null;
  const [row] = await db
    .insert(dealProducts)
    .values({
      dealId: input.dealId,
      productId: input.productId,
      name: product.name,
      quantity: input.quantity,
      unitPrice: input.unitPrice ?? product.price,
      discountPercent: input.discountPercent,
      position: (maxPosition ?? -1) + 1,
    })
    .returning();
  if (row === undefined) {
    return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "insert returned no rows"));
  }
  await syncDealValue(db, input.dealId, signal);
  return ok(row);
}

export async function updateDealProduct(
  db: Db,
  input: UpdateDealProductInput,
  signal: AbortSignal,
): Promise<Result<DealProduct, AppError>> {
  signal.throwIfAborted();
  const [row] = await db
    .update(dealProducts)
    .set({
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      discountPercent: input.discountPercent,
    })
    .where(eq(dealProducts.id, input.id))
    .returning();
  if (row === undefined) {
    return err(
      new AppError(ERROR_IDS.DEAL_PRODUCT_NOT_FOUND, "deal line item not found", { id: input.id }),
    );
  }
  await syncDealValue(db, row.dealId, signal);
  return ok(row);
}

export async function removeDealProduct(
  db: Db,
  id: string,
  signal: AbortSignal,
): Promise<Result<true, AppError>> {
  signal.throwIfAborted();
  const [row] = await db.delete(dealProducts).where(eq(dealProducts.id, id)).returning();
  if (row === undefined) {
    return err(new AppError(ERROR_IDS.DEAL_PRODUCT_NOT_FOUND, "deal line item not found", { id }));
  }
  await syncDealValue(db, row.dealId, signal);
  return ok(true);
}
