import { z } from "zod";
import { INVOICE_STATUS, INVOICE_TAX_MODE } from "@/db/schema/invoices";

export const createInvoiceInputSchema = z.object({
  dealId: z.string().uuid(),
  issueDate: z.string().date(),
  dueDate: z.string().date().nullable().default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
  taxMode: z.enum(INVOICE_TAX_MODE).default("exclusive"),
  billToName: z.string().trim().max(200).nullable().default(null),
  billToAddress: z.string().trim().max(500).nullable().default(null),
  billToEmail: z.string().trim().max(200).nullable().default(null),
  billToTaxId: z.string().trim().max(100).nullable().default(null),
  // Positional: index i is the tax rate for the i-th line item createInvoiceFromDeal snapshots
  // from the deal (deal_products ordered by position, same order the create dialog fetched them
  // in). Missing/short arrays default the remaining lines to "0".
  lineTaxRates: z.array(z.string()).optional(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceInputSchema>;

export const updateInvoiceStatusInputSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(INVOICE_STATUS),
});
export type UpdateInvoiceStatusInput = z.infer<typeof updateInvoiceStatusInputSchema>;

export const deleteInvoiceInputSchema = z.object({ id: z.string().uuid() });

const money = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/)
  .refine((v) => Number(v) >= 0, { message: "must not be negative" });

const percent = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/)
  .refine((v) => Number(v) >= 0 && Number(v) <= 100, { message: "must be between 0 and 100" });

export const addInvoiceLineItemInputSchema = z.object({
  invoiceId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: money.default("1"),
  unitPrice: money.optional(),
  discountPercent: percent.default("0"),
  taxRatePercent: percent.default("0"),
});
export type AddInvoiceLineItemInput = z.infer<typeof addInvoiceLineItemInputSchema>;

export const updateInvoiceLineItemInputSchema = z.object({
  id: z.string().uuid(),
  quantity: money,
  unitPrice: money,
  discountPercent: percent,
  taxRatePercent: percent,
});
export type UpdateInvoiceLineItemInput = z.infer<typeof updateInvoiceLineItemInputSchema>;

export const removeInvoiceLineItemInputSchema = z.object({ id: z.string().uuid() });
