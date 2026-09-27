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
import { automationConditionsSchema, dealMatchesConditions } from "./conditions";

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
    // The activity itself is the event; which deal it belongs to already scoped the call.
    case "activity_created":
    case "activity_completed":
      return true;
  }
}

// Conditions are validated on save; a row that somehow fails validation (hand-edited jsonb) never
// fires rather than firing unfiltered.
function ruleConditionsMet(rule: AutomationRule, deal: Deal): boolean {
  const parsed = automationConditionsSchema.safeParse(rule.conditions);
  return parsed.success && dealMatchesConditions(deal, parsed.data);
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

  return rules.filter(
    (rule) =>
      triggerMatchesConfig(
        trigger,
        rule.triggerConfig as Record<string, unknown>,
        dealBefore,
        dealAfter,
        fieldChanges,
      ) && ruleConditionsMet(rule, dealAfter),
  );
}

// Enqueues one automation.execute job per already-matched rule. Deliberately takes no `db`/`tx`:
// boss.send() writes through pg-boss's own connection pool, independent of any Drizzle
// transaction, so calling it from inside db.transaction(...) let a worker pick up and run the
// job before the outer mutation committed (or after it rolled back). Callers must only invoke
// this AFTER the transaction that produced `matched` has resolved successfully (see
// createDeal/moveDeal/updateDeal, which call matchAutomationRules on `tx` but this on the
// outside).
//
// retryLimit: 0 because actions are non-idempotent side effects (real email, real activity
// creation). pg-boss's default retry redelivers on a mid-loop handler failure (e.g. the job's
// own AbortSignal timing out mid-sendGmail) and would re-run every already-completed action in
// the same rule, duplicating those side effects. No idempotency key exists for individual
// actions yet, so "run once, log the failure" is the safe default over "maybe run twice".
//
// Deliberately untested against a real queue (see this task's Interfaces note): requireBoss()
// returns null in the test environment, so a direct test here would only ever exercise the
// no-op path. matchAutomationRules (above) carries the real test coverage; handleAutomationExecuteJob
// (Task 5) covers the consumer side.
export async function enqueueAutomationRuns(
  matched: AutomationRule[],
  dealId: string,
  trigger: AutomationTrigger,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (matched.length === 0) return;

  const boss = requireBoss();
  if (boss === null) return;
  for (const rule of matched) {
    await boss.send(
      PGBOSS_QUEUE_AUTOMATION_EXECUTE,
      { ruleId: rule.id, dealId, trigger },
      { retryLimit: 0 },
    );
  }
}

// Thin match-then-enqueue wrapper kept for callers outside a deal-mutation transaction (e.g. a
// future one-shot script or a test exercising the full path in one call). The three deal
// mutation call sites (createDeal/moveDeal/updateDeal) do NOT use this: they call
// matchAutomationRules on `tx` and enqueueAutomationRuns after the transaction commits, per the
// split described above.
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
  await enqueueAutomationRuns(matched, dealAfter.id, trigger, signal);
}
