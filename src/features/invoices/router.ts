import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { getInvoice, listInvoicesForDeal } from "./invoicesRepo";

export const invoicesRouter = router({
  listForDeal: protectedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      listInvoicesForDeal(ctx.db, input.dealId, AbortSignal.timeout(10_000)),
    ),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await getInvoice(ctx.db, input.id, AbortSignal.timeout(10_000));
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.error.id });
      return result.value;
    }),
});
