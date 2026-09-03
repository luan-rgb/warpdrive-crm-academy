import { and, eq, isNull, or } from "drizzle-orm";
import { PGBOSS_QUEUE_AUTOMATION_EXECUTE } from "@/constants/jobNames";
import {
  type AutomationRule,
  type AutomationTrigger,
  automationRules,
} from "@/db/schema/automations";
import type { Deal } from "@/db/schema/deals";
import { requireBoss } from "@/jobs/requireBoss";
import type { DbOrTx } from "@/server/realtime/channelVersions";

// One changed field, in the same shape logDealUpdateChanges already computes (field key
// matches src/constants/changeLogFields.ts, e.g. "title" or "custom_field:<key>").
export interface DealFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

function triggerMatchesConfig(
  trigger: AutomationTrigger,
  triggerConfig: Record<string, unknown>,
  dealBefore: Deal | null,
  dealAfter: Deal,
  fieldChanges: DealFieldChange[],
): boolean {
  switch (trigger) {
    case "deal_created":
      return true;
    case "deal_stage_changed": {
      if (dealBefore === null || dealBefore.stageId === dealAfter.stageId) return false;
      const toStageId = triggerConfig.toStageId;
      return toStageId == null || toStageId === dealAfter.stageId;
    }
    case "deal_status_changed": {
      if (dealBefore === null || dealBefore.status === dealAfter.status) return false;
      return triggerConfig.toStatus === dealAfter.status;
    }
    case "deal_field_changed":
      return fieldChanges.some((c) => c.field === triggerConfig.fieldKey);
  }
}

// Every active automation_rules row matching this deal mutation. Pure DB read, no pg-boss
// involved — this is the function evaluate.test.ts exercises against real Postgres.
//
// fieldChanges is only meaningful for trigger === "deal_field_changed"; other callers omit it.
export async function matchAutomationRules(
  db: DbOrTx,
  trigger: AutomationTrigger,
  dealBefore: Deal | null,
  dealAfter: Deal,
  signal: AbortSignal,
  fieldChanges: DealFieldChange[] = [],
): Promise<AutomationRule[]> {
  signal.throwIfAborted();
  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.trigger, trigger),
        eq(automationRules.isActive, true),
        or(
          isNull(automationRules.pipelineId),
          eq(automationRules.pipelineId, dealAfter.pipelineId),
        ),
      ),
    );
  signal.throwIfAborted();

  return rules.filter((rule) =>
    triggerMatchesConfig(
      trigger,
      rule.triggerConfig as Record<string, unknown>,
      dealBefore,
      dealAfter,
      fieldChanges,
    ),
  );
}

// Enqueues one automation.execute job per matched rule. Called inline from
// createDeal/moveDeal/updateDeal, mirroring how those functions already call
// recordChange/publishBoardEvent — there is no generic event bus in this codebase, so this
// follows the established pattern rather than introducing one.
//
// Deliberately untested on its own (see this task's Interfaces note): requireBoss() returns
// null in the test environment, so a direct test here would only ever exercise the no-op path.
// matchAutomationRules (above) carries the real test coverage; handleAutomationExecuteJob
// (Task 5) covers the consumer side.
export async function evaluateAutomations(
  db: DbOrTx,
  trigger: AutomationTrigger,
  dealBefore: Deal | null,
  dealAfter: Deal,
  signal: AbortSignal,
  fieldChanges: DealFieldChange[] = [],
): Promise<void> {
  const matched = await matchAutomationRules(
    db,
    trigger,
    dealBefore,
    dealAfter,
    signal,
    fieldChanges,
  );
  if (matched.length === 0) return;

  const boss = requireBoss();
  if (boss === null) return;
  for (const rule of matched) {
    await boss.send(PGBOSS_QUEUE_AUTOMATION_EXECUTE, {
      ruleId: rule.id,
      dealId: dealAfter.id,
      trigger,
    });
  }
}
