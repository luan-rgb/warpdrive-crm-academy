import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authorizeDealAccess } from "@/features/deals/dealAccess";
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
    .query(async ({ ctx, input }) => {
      const signal = AbortSignal.timeout(10_000);
      const access = await authorizeDealAccess(
        ctx.db,
        ctx.actor,
        { dealId: input.dealId },
        "read",
        signal,
      );
      if (!access.ok) throw new TRPCError({ code: "NOT_FOUND", message: access.error.id });
      return listDealProducts(ctx.db, input.dealId, signal);
    }),
});
