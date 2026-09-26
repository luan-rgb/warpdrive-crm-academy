"use server";

import type { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { authorizeDealAccess, type DealTarget } from "@/features/deals/dealAccess";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import { addDealProduct, removeDealProduct, updateDealProduct } from "./dealProductsRepo";
import {
  addDealProductInputSchema,
  archiveProductInputSchema,
  createProductInputSchema,
  removeDealProductInputSchema,
  updateDealProductInputSchema,
  updateProductInputSchema,
} from "./productSchema";
import { archiveProduct, createProduct, updateProduct } from "./productsRepo";

type ActionResult<T> = { ok: true; value: T } | { ok: false; error: { id: string } };

// The ACTION layer enforces the product.manage gate for the catalog: the repo functions are
// ungated (same split as custom-fields' gateMetadata).
async function gateProductManage(
  csrfToken: string | null,
): Promise<{ ok: true } | { ok: false; error: { id: string } }> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  if (!can(actor, "product.manage")) return { ok: false, error: { id: ERROR_IDS.PERM_DENIED } };
  return { ok: true };
}

// Adding a product to a deal is a normal deal-edit action, not catalog management: the actor must
// be able to edit that deal (the line items rewrite the deal's value).
async function gateDealEdit(
  csrfToken: string | null,
  target: DealTarget,
): Promise<{ ok: true } | { ok: false; error: { id: string } }> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const access = await authorizeDealAccess(db, actor, target, "edit", SIG());
  return access.ok ? { ok: true } : { ok: false, error: { id: access.error.id } };
}

export async function createProductAction(
  input: z.input<typeof createProductInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateProductManage(csrfToken);
  if (!g.ok) return g;
  const parsed = createProductInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.PRODUCT_INPUT_INVALID } };
  const result = await createProduct(db, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function updateProductAction(
  input: z.input<typeof updateProductInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateProductManage(csrfToken);
  if (!g.ok) return g;
  const parsed = updateProductInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.PRODUCT_INPUT_INVALID } };
  const result = await updateProduct(db, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function archiveProductAction(
  input: z.input<typeof archiveProductInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateProductManage(csrfToken);
  if (!g.ok) return g;
  const parsed = archiveProductInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.PRODUCT_INPUT_INVALID } };
  const result = await archiveProduct(db, parsed.data.id, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function addDealProductAction(
  input: z.input<typeof addDealProductInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const parsed = addDealProductInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.DEAL_PRODUCT_INPUT_INVALID } };
  const g = await gateDealEdit(csrfToken, { dealId: parsed.data.dealId });
  if (!g.ok) return g;
  const result = await addDealProduct(db, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function updateDealProductAction(
  input: z.input<typeof updateDealProductInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const parsed = updateDealProductInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.DEAL_PRODUCT_INPUT_INVALID } };
  const g = await gateDealEdit(csrfToken, { dealProductId: parsed.data.id });
  if (!g.ok) return g;
  const result = await updateDealProduct(db, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function removeDealProductAction(
  input: z.input<typeof removeDealProductInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const parsed = removeDealProductInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.DEAL_PRODUCT_INPUT_INVALID } };
  const g = await gateDealEdit(csrfToken, { dealProductId: parsed.data.id });
  if (!g.ok) return g;
  const result = await removeDealProduct(db, parsed.data.id, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}
