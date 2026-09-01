"use server";

import type { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import {
  addInvoiceLineItemInputSchema,
  createInvoiceInputSchema,
  deleteInvoiceInputSchema,
  removeInvoiceLineItemInputSchema,
  updateInvoiceLineItemInputSchema,
  updateInvoiceStatusInputSchema,
} from "./invoiceSchema";
import {
  addInvoiceLineItem,
  createInvoiceFromDeal,
  deleteInvoice,
  removeInvoiceLineItem,
  updateInvoiceLineItem,
  updateInvoiceStatus,
} from "./invoicesRepo";

type ActionResult<T> = { ok: true; value: T } | { ok: false; error: { id: string } };

// The ACTION layer enforces the invoice.manage gate: the repo functions are ungated (same split
// as products' gateProductManage).
async function gateInvoiceManage(
  csrfToken: string | null,
): Promise<{ ok: true } | { ok: false; error: { id: string } }> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  if (!can(actor, "invoice.manage")) return { ok: false, error: { id: ERROR_IDS.PERM_DENIED } };
  return { ok: true };
}

export async function createInvoiceAction(
  input: z.input<typeof createInvoiceInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateInvoiceManage(csrfToken);
  if (!g.ok) return g;
  const parsed = createInvoiceInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.INVOICE_INPUT_INVALID } };
  const result = await createInvoiceFromDeal(db, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function updateInvoiceStatusAction(
  input: z.input<typeof updateInvoiceStatusInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateInvoiceManage(csrfToken);
  if (!g.ok) return g;
  const parsed = updateInvoiceStatusInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.INVOICE_INPUT_INVALID } };
  const result = await updateInvoiceStatus(db, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function deleteInvoiceAction(
  input: z.input<typeof deleteInvoiceInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateInvoiceManage(csrfToken);
  if (!g.ok) return g;
  const parsed = deleteInvoiceInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.INVOICE_INPUT_INVALID } };
  const result = await deleteInvoice(db, parsed.data.id, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function addInvoiceLineItemAction(
  input: z.input<typeof addInvoiceLineItemInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateInvoiceManage(csrfToken);
  if (!g.ok) return g;
  const parsed = addInvoiceLineItemInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.INVOICE_INPUT_INVALID } };
  const result = await addInvoiceLineItem(db, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function updateInvoiceLineItemAction(
  input: z.input<typeof updateInvoiceLineItemInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateInvoiceManage(csrfToken);
  if (!g.ok) return g;
  const parsed = updateInvoiceLineItemInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.INVOICE_INPUT_INVALID } };
  const result = await updateInvoiceLineItem(db, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function removeInvoiceLineItemAction(
  input: z.input<typeof removeInvoiceLineItemInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateInvoiceManage(csrfToken);
  if (!g.ok) return g;
  const parsed = removeInvoiceLineItemInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.INVOICE_INPUT_INVALID } };
  const result = await removeInvoiceLineItem(db, parsed.data.id, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}
