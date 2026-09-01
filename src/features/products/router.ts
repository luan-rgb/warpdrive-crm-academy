import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { listDealProducts } from "./dealProductsRepo";
import { listProducts } from "./productsRepo";

export const productsRouter = router({
  list: protectedProcedure
    .input(z.object({ includeArchived: z.boolean().default(false) }))
    .query(({ ctx, input }) =>
      listProducts(ctx.db, { includeArchived: input.includeArchived }, AbortSignal.timeout(10_000)),
    ),

  byDeal: protectedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(({ ctx, input }) => listDealProducts(ctx.db, input.dealId, AbortSignal.timeout(10_000))),
});
