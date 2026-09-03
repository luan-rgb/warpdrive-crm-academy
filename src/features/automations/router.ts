import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { automationRuns } from "@/db/schema/automations";
import { can } from "@/features/permissions/can";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { getAutomationRule, listAutomationRules } from "./rulesRepo";

// Rule configs carry email subject/body templates and notification message templates, more
// sensitive than typical read data, so every read here requires automation.manage, matching
// the gate every other surface for this data (settings pages, actions.ts) already uses.
const automationProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!can(ctx.actor, "automation.manage")) {
    throw new TRPCError({ code: "FORBIDDEN", message: ERROR_IDS.PERM_DENIED });
  }
  return next();
});

export const automationsRouter = router({
  list: automationProcedure.query(({ ctx }) =>
    listAutomationRules(ctx.db, AbortSignal.timeout(10_000)),
  ),

  get: automationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await getAutomationRule(ctx.db, input.id, AbortSignal.timeout(10_000));
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.error.id });
      return result.value;
    }),

  listRunsForRule: automationProcedure
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
