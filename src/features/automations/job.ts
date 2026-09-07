import { eq } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { PGBOSS_QUEUE_AUTOMATION_EXECUTE } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { db as prodDb } from "@/db/client";
import type { AutomationTrigger } from "@/db/schema/automations";
import { automationRunActions, automationRuns } from "@/db/schema/automations";
import { deals } from "@/db/schema/deals";
import { runAction } from "./actionRunners";
import { getAutomationRule } from "./rulesRepo";

interface AutomationExecuteJob {
  data: { ruleId: string; dealId: string; trigger: AutomationTrigger };
}

// Re-reads the rule, its actions, and the deal at fire time (never trusts data captured at
// enqueue time: the deal may have moved further, or the rule may have been edited, between
// evaluateAutomations enqueueing this job and it actually running). Runs every action even
// after one fails, recording each outcome independently.
export async function handleAutomationExecuteJob(
  db: Db,
  job: AutomationExecuteJob,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const ruleResult = await getAutomationRule(db, job.data.ruleId, signal);
  if (!ruleResult.ok) return; // rule deleted since enqueue: nothing to run, nothing to log.

  const [deal] = await db.select().from(deals).where(eq(deals.id, job.data.dealId));
  if (deal === undefined) return; // deal deleted since enqueue.

  const [run] = await db
    .insert(automationRuns)
    .values({
      ruleId: ruleResult.value.rule.id,
      ruleName: ruleResult.value.rule.name,
      dealId: deal.id,
      trigger: job.data.trigger,
      status: "success", // provisional; corrected below once every action has run.
    })
    .returning();
  if (run === undefined) return;

  const outcomes: ("success" | "error" | "skipped")[] = [];
  for (const action of ruleResult.value.actions) {
    signal.throwIfAborted();
    const outcome = await runAction(db, deal, action, signal);
    outcomes.push(outcome.status);
    await db.insert(automationRunActions).values({
      runId: run.id,
      position: action.position,
      actionType: action.actionType,
      status: outcome.status,
      errorMessage: outcome.errorMessage,
      resultSummary: outcome.resultSummary,
    });
  }

  const allSucceeded = outcomes.every((s) => s === "success");
  const allFailed = outcomes.every((s) => s === "error");
  const finalStatus = allSucceeded ? "success" : allFailed ? "error" : "partial";
  await db
    .update(automationRuns)
    .set({ status: finalStatus, finishedAt: new Date() })
    .where(eq(automationRuns.id, run.id));
}

export async function registerAutomationExecuteWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue(PGBOSS_QUEUE_AUTOMATION_EXECUTE);
  await boss.work(
    PGBOSS_QUEUE_AUTOMATION_EXECUTE,
    async ([job]: Job<{ ruleId: string; dealId: string; trigger: AutomationTrigger }>[]) => {
      if (job === undefined) return;
      await handleAutomationExecuteJob(prodDb, job, AbortSignal.timeout(30_000));
    },
  );
}
