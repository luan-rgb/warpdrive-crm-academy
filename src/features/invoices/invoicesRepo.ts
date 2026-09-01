import { asc, desc, eq, max } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema/deals";
import { type InvoiceLineItem, invoiceLineItems } from "@/db/schema/invoiceLineItems";
import { type Invoice, invoices } from "@/db/schema/invoices";
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
  const total = dealLines.reduce((sum, line) => {
    const lineTotal =
      Number(line.quantity) * Number(line.unitPrice) * (1 - Number(line.discountPercent) / 100);
    return sum + lineTotal;
  }, 0);

  const result = await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        dealId: input.dealId,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        notes: input.notes,
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

function lineTotal(quantity: string, unitPrice: string, discountPercent: string): number {
  return Number(quantity) * Number(unitPrice) * (1 - Number(discountPercent) / 100);
}

async function recomputeInvoiceTotal(
  db: Db,
  invoiceId: string,
  signal: AbortSignal,
): Promise<void> {
  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId));
  signal.throwIfAborted();
  const total = lines.reduce(
    (sum, l) => sum + lineTotal(l.quantity, l.unitPrice, l.discountPercent),
    0,
  );
  await db
    .update(invoices)
    .set({ total: total.toFixed(2) })
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
      position: (maxPosition ?? -1) + 1,
    })
    .returning();
  if (row === undefined) {
    return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "insert returned no rows"));
  }
  await recomputeInvoiceTotal(db, input.invoiceId, signal);
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
    })
    .where(eq(invoiceLineItems.id, input.id))
    .returning();
  if (row === undefined) {
    return err(
      new AppError(ERROR_IDS.INVOICE_LINE_NOT_FOUND, "line item not found", { id: input.id }),
    );
  }
  await recomputeInvoiceTotal(db, existing.invoiceId, signal);
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
  await recomputeInvoiceTotal(db, existing.invoiceId, signal);
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
