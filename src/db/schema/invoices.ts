import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { deals } from "./deals";

export const INVOICE_STATUS = ["issued", "paid", "canceled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];
export const invoiceStatus = pgEnum("invoice_status", INVOICE_STATUS);

// How the entered unit prices relate to invoice.taxTotal: "exclusive" prices exclude tax (tax is
// added on top), "inclusive" prices already include tax (tax is backed out of the price), "none"
// means no tax line at all. Mirrors the "Amounts are" radio on the reference Xero create-invoice
// form. Purely a display/arithmetic line, not a fiscal computation (see the comment below).
export const INVOICE_TAX_MODE = ["exclusive", "inclusive", "none"] as const;
export type InvoiceTaxMode = (typeof INVOICE_TAX_MODE)[number];
export const invoiceTaxMode = pgEnum("invoice_tax_mode", INVOICE_TAX_MODE);

// Internal billing record, not a fiscal document: no tax authority integration, no digital
// certificate. It tracks what was billed and whether it was paid, for the CRM's own records.
// sequenceNumber is a plain identity column; the human-facing "INV-0001" label is derived from
// it at render time rather than stored, so a display-format change never touches historical rows.
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sequenceNumber: integer("sequence_number").generatedAlwaysAsIdentity(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "restrict" }),
    status: invoiceStatus("status").notNull().default("issued"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    notes: text("notes"),
    // numeric(14,2): same convention as deals.value and products.price.
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
    // subtotal excludes tax, taxTotal is the computed tax line; total = subtotal + taxTotal
    // always holds (in "inclusive" mode subtotal is backed out of tax-included line prices).
    // Stored rather than derived at render time because line items can later be edited while an
    // invoice is still "issued", and recomputeInvoiceTotal already owns that recompute.
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
    taxTotal: numeric("tax_total", { precision: 14, scale: 2 }).notNull().default("0"),
    taxMode: invoiceTaxMode("tax_mode").notNull().default("exclusive"),
    // Customer snapshot, taken from the deal's org/person at creation time (createInvoiceFromDeal
    // fills these when the caller doesn't supply them). Never re-read live from organizations/
    // persons: an invoice is a historical document, so a later org rename must not rewrite it.
    billToName: text("bill_to_name"),
    billToAddress: text("bill_to_address"),
    billToEmail: text("bill_to_email"),
    billToTaxId: text("bill_to_tax_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("invoices_deal_idx").on(t.dealId, t.createdAt)],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
