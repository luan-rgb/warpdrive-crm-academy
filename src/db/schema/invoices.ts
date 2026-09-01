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
