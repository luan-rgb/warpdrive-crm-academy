import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authorizeDealAccess } from "@/features/deals/dealAccess";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { getInvoice, listInvoicesForDeal } from "./invoicesRepo";

export const invoicesRouter = router({
  listForDeal: protectedProcedure
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
      return listInvoicesForDeal(ctx.db, input.dealId, signal);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const signal = AbortSignal.timeout(10_000);
      const access = await authorizeDealAccess(
        ctx.db,
        ctx.actor,
        { invoiceId: input.id },
        "read",
        signal,
      );
      if (!access.ok) throw new TRPCError({ code: "NOT_FOUND", message: access.error.id });
      const result = await getInvoice(ctx.db, input.id, signal);
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.error.id });
      return result.value;
    }),
});
