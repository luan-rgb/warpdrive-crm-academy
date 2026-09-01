import { and, asc, eq, ne } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { type Product, products } from "@/db/schema/products";
import { err, ok, type Result } from "@/types/result";
import type { CreateProductInput, UpdateProductInput } from "./productSchema";

export async function listProducts(
  db: Db,
  opts: { includeArchived?: boolean },
  signal: AbortSignal,
): Promise<Product[]> {
  signal.throwIfAborted();
  const includeArchived = opts.includeArchived === true;
  const base = db.select().from(products);
  const rows = includeArchived
    ? await base.orderBy(asc(products.name))
    : await base.where(eq(products.isArchived, false)).orderBy(asc(products.name));
  return rows;
}

async function assertSkuFree(
  db: Db,
  sku: string | null,
  excludeId: string | undefined,
): Promise<Result<true, AppError>> {
  if (sku === null || sku === "") return ok(true);
  const where =
    excludeId === undefined
      ? and(eq(products.sku, sku), eq(products.isArchived, false))
      : and(eq(products.sku, sku), eq(products.isArchived, false), ne(products.id, excludeId));
  const existing = await db.select({ id: products.id }).from(products).where(where);
  if (existing.length > 0) {
    return err(new AppError(ERROR_IDS.PRODUCT_SKU_EXISTS, "sku already in use", { sku }));
  }
  return ok(true);
}

export async function createProduct(
  db: Db,
  input: CreateProductInput,
  signal: AbortSignal,
): Promise<Result<Product, AppError>> {
  signal.throwIfAborted();
  const skuCheck = await assertSkuFree(db, input.sku, undefined);
  if (!skuCheck.ok) return skuCheck;
  const [row] = await db
    .insert(products)
    .values({
      name: input.name,
      sku: input.sku,
      price: input.price,
      unit: input.unit,
      description: input.description,
    })
    .returning();
  if (row === undefined) {
    return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "insert returned no rows"));
  }
  return ok(row);
}

export async function updateProduct(
  db: Db,
  input: UpdateProductInput,
  signal: AbortSignal,
): Promise<Result<Product, AppError>> {
  signal.throwIfAborted();
  const skuCheck = await assertSkuFree(db, input.sku, input.id);
  if (!skuCheck.ok) return skuCheck;
  const [row] = await db
    .update(products)
    .set({
      name: input.name,
      sku: input.sku,
      price: input.price,
      unit: input.unit,
      description: input.description,
    })
    .where(eq(products.id, input.id))
    .returning();
  if (row === undefined) {
    return err(new AppError(ERROR_IDS.PRODUCT_NOT_FOUND, "product not found", { id: input.id }));
  }
  return ok(row);
}

export async function archiveProduct(
  db: Db,
  id: string,
  signal: AbortSignal,
): Promise<Result<Product, AppError>> {
  signal.throwIfAborted();
  const [row] = await db
    .update(products)
    .set({ isArchived: true })
    .where(eq(products.id, id))
    .returning();
  if (row === undefined) {
    return err(new AppError(ERROR_IDS.PRODUCT_NOT_FOUND, "product not found", { id }));
  }
  return ok(row);
}
