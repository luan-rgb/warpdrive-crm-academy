import { integer, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { invoices } from "./invoices";

// A snapshot of the deal's line items at the moment the invoice was issued: an invoice is a
// historical document, so a later price edit or removal on the deal's own products must not
// silently rewrite a bill already sent. No updatedAt: a snapshot row is never edited after
// creation, only the parent invoice's status changes.
export const invoiceLineItems = pgTable("invoice_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 2 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull(),
  taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  position: integer("position").notNull().default(0),
});

export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItems.$inferInsert;
