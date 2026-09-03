import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { automationRuns } from "@/db/schema/automations";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { getAutomationRule, listAutomationRules } from "./rulesRepo";

export const automationsRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    listAutomationRules(ctx.db, AbortSignal.timeout(10_000)),
  ),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await getAutomationRule(ctx.db, input.id, AbortSignal.timeout(10_000));
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.error.id });
      return result.value;
    }),

  listRunsForRule: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      ctx.db
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.ruleId, input.ruleId))
        .orderBy(desc(automationRuns.startedAt))
        .limit(100),
    ),
});
