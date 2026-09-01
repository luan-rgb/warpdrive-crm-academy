import { z } from "zod";
import { INVOICE_STATUS } from "@/db/schema/invoices";

export const createInvoiceInputSchema = z.object({
  dealId: z.string().uuid(),
  issueDate: z.string().date(),
  dueDate: z.string().date().nullable().default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
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

export const addInvoiceLineItemInputSchema = z.object({
  invoiceId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: money.default("1"),
  unitPrice: money.optional(),
  discountPercent: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine((v) => Number(v) >= 0 && Number(v) <= 100, { message: "must be between 0 and 100" })
    .default("0"),
});
export type AddInvoiceLineItemInput = z.infer<typeof addInvoiceLineItemInputSchema>;

export const updateInvoiceLineItemInputSchema = z.object({
  id: z.string().uuid(),
  quantity: money,
  unitPrice: money,
  discountPercent: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine((v) => Number(v) >= 0 && Number(v) <= 100, { message: "must be between 0 and 100" }),
});
export type UpdateInvoiceLineItemInput = z.infer<typeof updateInvoiceLineItemInputSchema>;

export const removeInvoiceLineItemInputSchema = z.object({ id: z.string().uuid() });
