import { z } from "zod";

// Money as a decimal string (same convention as goals.target): survives the round trip to
// numeric(14,2) without a float in the middle.
const money = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/)
  .refine((v) => Number(v) >= 0, { message: "must not be negative" });

export const createProductInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  sku: z.string().trim().max(100).nullable().default(null),
  price: money,
  unit: z.string().trim().min(1).max(50).default("un"),
  description: z.string().trim().max(2000).nullable().default(null),
});
export type CreateProductInput = z.infer<typeof createProductInputSchema>;

export const updateProductInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  sku: z.string().trim().max(100).nullable().default(null),
  price: money,
  unit: z.string().trim().min(1).max(50).default("un"),
  description: z.string().trim().max(2000).nullable().default(null),
});
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;

export const archiveProductInputSchema = z.object({ id: z.string().uuid() });

export const addDealProductInputSchema = z.object({
  dealId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: money.default("1"),
  // Defaults to the catalog price at add time; the caller may override (discount negotiated
  // on this specific deal) which is why it is a plain optional, not derived server-side only.
  unitPrice: money.optional(),
  discountPercent: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine((v) => Number(v) >= 0 && Number(v) <= 100, { message: "must be between 0 and 100" })
    .default("0"),
});
export type AddDealProductInput = z.infer<typeof addDealProductInputSchema>;

export const updateDealProductInputSchema = z.object({
  id: z.string().uuid(),
  quantity: money,
  unitPrice: money,
  discountPercent: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine((v) => Number(v) >= 0 && Number(v) <= 100, { message: "must be between 0 and 100" }),
});
export type UpdateDealProductInput = z.infer<typeof updateDealProductInputSchema>;

export const removeDealProductInputSchema = z.object({ id: z.string().uuid() });
