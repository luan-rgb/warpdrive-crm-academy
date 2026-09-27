import { TRPCError } from "@trpc/server";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { automationRunActions, automationRuns } from "@/db/schema/automations";
import { deals } from "@/db/schema/deals";
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

  // The rule's run history (settings page): each run with its deal and every action's outcome,
  // so a user can see why an automation did or did not do something.
  listRunsForRule: automationProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const runs = await ctx.db
        .select({
          id: automationRuns.id,
          dealId: automationRuns.dealId,
          dealTitle: deals.title,
          trigger: automationRuns.trigger,
          status: automationRuns.status,
          startedAt: automationRuns.startedAt,
          finishedAt: automationRuns.finishedAt,
        })
        .from(automationRuns)
        .leftJoin(deals, eq(deals.id, automationRuns.dealId))
        .where(eq(automationRuns.ruleId, input.ruleId))
        .orderBy(desc(automationRuns.startedAt))
        .limit(100);
      if (runs.length === 0) return [];
      const actionRows = await ctx.db
        .select({
          runId: automationRunActions.runId,
          position: automationRunActions.position,
          actionType: automationRunActions.actionType,
          status: automationRunActions.status,
          errorMessage: automationRunActions.errorMessage,
        })
        .from(automationRunActions)
        .where(
          inArray(
            automationRunActions.runId,
            runs.map((r) => r.id),
          ),
        )
        .orderBy(asc(automationRunActions.position));
      return runs.map((r) => ({
        ...r,
        actions: actionRows
          .filter((a) => a.runId === r.id)
          .map((a) => ({
            position: a.position,
            actionType: a.actionType,
            status: a.status,
            errorMessage: a.errorMessage,
          })),
      }));
    }),
});
