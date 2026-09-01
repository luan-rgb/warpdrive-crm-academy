import { asc, desc, eq, max } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema/deals";
import { type InvoiceLineItem, invoiceLineItems } from "@/db/schema/invoiceLineItems";
import { type Invoice, type InvoiceTaxMode, invoices } from "@/db/schema/invoices";
import { organizations } from "@/db/schema/organizations";
import { persons } from "@/db/schema/persons";
import { products } from "@/db/schema/products";
import { listDealProducts } from "@/features/products/dealProductsRepo";
import { err, ok, type Result } from "@/types/result";
import type {
  AddInvoiceLineItemInput,
  CreateInvoiceInput,
  UpdateInvoiceLineItemInput,
  UpdateInvoiceStatusInput,
} from "./invoiceSchema";

export interface InvoiceWithLines {
  invoice: Invoice;
  lines: InvoiceLineItem[];
}

function lineTotal(quantity: string, unitPrice: string, discountPercent: string): number {
  return Number(quantity) * Number(unitPrice) * (1 - Number(discountPercent) / 100);
}

// Tax on one line's base amount, in the given mode. "exclusive" adds tax on top of base;
// "inclusive" backs the tax out of a base that already includes it; "none" has no tax line.
// Purely arithmetic (see the fiscal-document comment on the invoices table) — not a tax-authority
// computation, so there is no rounding-rule table or jurisdiction lookup here.
function lineTaxAmount(base: number, taxRatePercent: string, taxMode: InvoiceTaxMode): number {
  if (taxMode === "none") return 0;
  const rate = Number(taxRatePercent) / 100;
  if (taxMode === "inclusive") return base - base / (1 + rate);
  return base * rate;
}

interface TaxableLine {
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRatePercent: string;
}

function computeInvoiceTotals(
  lines: TaxableLine[],
  taxMode: InvoiceTaxMode,
): { subtotal: number; taxTotal: number; total: number } {
  let base = 0;
  let tax = 0;
  for (const l of lines) {
    const lineBase = lineTotal(l.quantity, l.unitPrice, l.discountPercent);
    base += lineBase;
    tax += lineTaxAmount(lineBase, l.taxRatePercent, taxMode);
  }
  if (taxMode === "inclusive") {
    return { subtotal: base - tax, taxTotal: tax, total: base };
  }
  return { subtotal: base, taxTotal: tax, total: base + tax };
}

// Flattens the org.address JSONB shape (street/city/region/postal/country, same keys the
// Organization sidebar edits — see OrgBlock.tsx's formatAddress) into one display line for the
// bill-to snapshot. Duplicated here rather than imported: the sidebar's copy lives in a
// "use client" file, and this repo module is server-only.
const ADDRESS_KEYS = ["street", "city", "region", "postal", "country"] as const;
function formatAddress(address: Record<string, unknown> | null): string | null {
  if (address === null) return null;
  const parts = ADDRESS_KEYS.map((key) => address[key]).filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export async function listInvoicesForDeal(
  db: Db,
  dealId: string,
  signal: AbortSignal,
): Promise<Invoice[]> {
  signal.throwIfAborted();
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.dealId, dealId))
    .orderBy(desc(invoices.createdAt));
}

export async function getInvoice(
  db: Db,
  id: string,
  signal: AbortSignal,
): Promise<Result<InvoiceWithLines, AppError>> {
  signal.throwIfAborted();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (invoice === undefined) {
    return err(new AppError(ERROR_IDS.INVOICE_NOT_FOUND, "invoice not found", { id }));
  }
  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, id))
    .orderBy(asc(invoiceLineItems.position));
  return ok({ invoice, lines });
}

// Snapshots the deal's current line items onto a new invoice: an invoice is a historical
// document (docs/architecture.md's "validate at the boundary, trust inside" applies here too),
// so a later edit to the deal's products must never rewrite an invoice already issued.
export async function createInvoiceFromDeal(
  db: Db,
  input: CreateInvoiceInput,
  signal: AbortSignal,
): Promise<Result<InvoiceWithLines, AppError>> {
  signal.throwIfAborted();
  const [deal] = await db.select().from(deals).where(eq(deals.id, input.dealId));
  if (deal === undefined) {
    return err(
      new AppError(ERROR_IDS.INVOICE_INPUT_INVALID, "deal not found", {
        dealId: input.dealId,
      }),
    );
  }
  const dealLines = await listDealProducts(db, input.dealId, signal);
  if (dealLines.length === 0) {
    return err(
      new AppError(ERROR_IDS.INVOICE_NO_LINE_ITEMS, "deal has no products to invoice", {
        dealId: input.dealId,
      }),
    );
  }

  const org =
    deal.orgId != null
      ? (await db.select().from(organizations).where(eq(organizations.id, deal.orgId)))[0]
      : undefined;
  const person =
    deal.personId != null
      ? (await db.select().from(persons).where(eq(persons.id, deal.personId)))[0]
      : undefined;

  const billToName = input.billToName ?? org?.name ?? person?.name ?? null;
  const billToAddress = input.billToAddress ?? formatAddress(org?.address ?? null);
  const billToEmail = input.billToEmail ?? person?.primaryEmail ?? null;
  const billToTaxId = input.billToTaxId;

  const taxRates = input.lineTaxRates ?? [];
  const taxableLines: TaxableLine[] = dealLines.map((line, i) => ({
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    taxRatePercent: taxRates[i] ?? "0",
  }));
  const { subtotal, taxTotal, total } = computeInvoiceTotals(taxableLines, input.taxMode);

  const result = await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        dealId: input.dealId,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        notes: input.notes,
        taxMode: input.taxMode,
        billToName,
        billToAddress,
        billToEmail,
        billToTaxId,
        subtotal: subtotal.toFixed(2),
        taxTotal: taxTotal.toFixed(2),
        total: total.toFixed(2),
      })
      .returning();
    if (invoice === undefined) {
      throw new AppError(
        ERROR_IDS.DB_INSERT_FAILED,
        "createInvoiceFromDeal: insert returned no rows",
      );
    }
    const lines = await tx
      .insert(invoiceLineItems)
      .values(
        dealLines.map((line, i) => ({
          invoiceId: invoice.id,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          taxRatePercent: taxRates[i] ?? "0",
          position: i,
        })),
      )
      .returning();
    return { invoice, lines };
  });
  return ok(result);
}

export async function deleteInvoice(
  db: Db,
  id: string,
  signal: AbortSignal,
): Promise<Result<true, AppError>> {
  signal.throwIfAborted();
  const [row] = await db.delete(invoices).where(eq(invoices.id, id)).returning();
  if (row === undefined) {
    return err(new AppError(ERROR_IDS.INVOICE_DELETE_NOT_FOUND, "invoice not found", { id }));
  }
  return ok(true);
}

async function recomputeInvoiceTotal(
  db: Db,
  invoiceId: string,
  taxMode: InvoiceTaxMode,
  signal: AbortSignal,
): Promise<void> {
  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId));
  signal.throwIfAborted();
  const { subtotal, taxTotal, total } = computeInvoiceTotals(lines, taxMode);
  await db
    .update(invoices)
    .set({
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      total: total.toFixed(2),
    })
    .where(eq(invoices.id, invoiceId));
}

// A paid or canceled invoice is a closed record: only an "issued" invoice may still have its
// line items changed.
async function assertEditable(db: Db, invoiceId: string): Promise<Result<Invoice, AppError>> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (invoice === undefined) {
    return err(new AppError(ERROR_IDS.INVOICE_NOT_FOUND, "invoice not found", { id: invoiceId }));
  }
  if (invoice.status !== "issued") {
    return err(
      new AppError(ERROR_IDS.INVOICE_NOT_EDITABLE, "invoice is not editable", {
        id: invoiceId,
        status: invoice.status,
      }),
    );
  }
  return ok(invoice);
}

export async function addInvoiceLineItem(
  db: Db,
  input: AddInvoiceLineItemInput,
  signal: AbortSignal,
): Promise<Result<InvoiceLineItem, AppError>> {
  signal.throwIfAborted();
  const editable = await assertEditable(db, input.invoiceId);
  if (!editable.ok) return editable;
  const [product] = await db.select().from(products).where(eq(products.id, input.productId));
  if (product === undefined) {
    return err(
      new AppError(ERROR_IDS.PRODUCT_NOT_FOUND, "product not found", { id: input.productId }),
    );
  }
  const [positionRow] = await db
    .select({ maxPosition: max(invoiceLineItems.position) })
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, input.invoiceId));
  const maxPosition = positionRow?.maxPosition ?? null;
  const [row] = await db
    .insert(invoiceLineItems)
    .values({
      invoiceId: input.invoiceId,
      name: product.name,
      quantity: input.quantity,
      unitPrice: input.unitPrice ?? product.price,
      discountPercent: input.discountPercent,
      taxRatePercent: input.taxRatePercent,
      position: (maxPosition ?? -1) + 1,
    })
    .returning();
  if (row === undefined) {
    return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "insert returned no rows"));
  }
  await recomputeInvoiceTotal(db, input.invoiceId, editable.value.taxMode, signal);
  return ok(row);
}

export async function updateInvoiceLineItem(
  db: Db,
  input: UpdateInvoiceLineItemInput,
  signal: AbortSignal,
): Promise<Result<InvoiceLineItem, AppError>> {
  signal.throwIfAborted();
  const [existing] = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.id, input.id));
  if (existing === undefined) {
    return err(
      new AppError(ERROR_IDS.INVOICE_LINE_NOT_FOUND, "line item not found", { id: input.id }),
    );
  }
  const editable = await assertEditable(db, existing.invoiceId);
  if (!editable.ok) return editable;
  const [row] = await db
    .update(invoiceLineItems)
    .set({
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      discountPercent: input.discountPercent,
      taxRatePercent: input.taxRatePercent,
    })
    .where(eq(invoiceLineItems.id, input.id))
    .returning();
  if (row === undefined) {
    return err(
      new AppError(ERROR_IDS.INVOICE_LINE_NOT_FOUND, "line item not found", { id: input.id }),
    );
  }
  await recomputeInvoiceTotal(db, existing.invoiceId, editable.value.taxMode, signal);
  return ok(row);
}

export async function removeInvoiceLineItem(
  db: Db,
  id: string,
  signal: AbortSignal,
): Promise<Result<true, AppError>> {
  signal.throwIfAborted();
  const [existing] = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.id, id));
  if (existing === undefined) {
    return err(new AppError(ERROR_IDS.INVOICE_LINE_NOT_FOUND, "line item not found", { id }));
  }
  const editable = await assertEditable(db, existing.invoiceId);
  if (!editable.ok) return editable;
  await db.delete(invoiceLineItems).where(eq(invoiceLineItems.id, id));
  await recomputeInvoiceTotal(db, existing.invoiceId, editable.value.taxMode, signal);
  return ok(true);
}

export async function updateInvoiceStatus(
  db: Db,
  input: UpdateInvoiceStatusInput,
  signal: AbortSignal,
): Promise<Result<Invoice, AppError>> {
  signal.throwIfAborted();
  const [existing] = await db.select().from(invoices).where(eq(invoices.id, input.id));
  if (existing === undefined) {
    return err(new AppError(ERROR_IDS.INVOICE_NOT_FOUND, "invoice not found", { id: input.id }));
  }
  if (existing.status === "canceled") {
    return err(
      new AppError(ERROR_IDS.INVOICE_ALREADY_CANCELED, "invoice is canceled", { id: input.id }),
    );
  }
  const [row] = await db
    .update(invoices)
    .set({ status: input.status })
    .where(eq(invoices.id, input.id))
    .returning();
  if (row === undefined) {
    return err(new AppError(ERROR_IDS.INVOICE_NOT_FOUND, "invoice not found", { id: input.id }));
  }
  return ok(row);
}
