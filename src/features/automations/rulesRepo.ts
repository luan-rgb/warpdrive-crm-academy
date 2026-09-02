import { desc, eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  type AutomationRule,
  type AutomationRuleAction,
  automationRuleActions,
  automationRules,
} from "@/db/schema/automations";
import { err, ok, type Result } from "@/types/result";
import type { CreateAutomationRuleInput, UpdateAutomationRuleInput } from "./schemas";

export interface AutomationRuleWithActions {
  rule: AutomationRule;
  actions: AutomationRuleAction[];
}

export async function listAutomationRules(db: Db, signal: AbortSignal): Promise<AutomationRule[]> {
  signal.throwIfAborted();
  return db.select().from(automationRules).orderBy(desc(automationRules.createdAt));
}

export async function getAutomationRule(
  db: Db,
  id: string,
  signal: AbortSignal,
): Promise<Result<AutomationRuleWithActions, AppError>> {
  signal.throwIfAborted();
  const [rule] = await db.select().from(automationRules).where(eq(automationRules.id, id));
  if (rule === undefined) {
    return err(new AppError(ERROR_IDS.AUTOMATION_NOT_FOUND, "automation rule not found", { id }));
  }
  const actions = await db
    .select()
    .from(automationRuleActions)
    .where(eq(automationRuleActions.ruleId, id))
    .orderBy(automationRuleActions.position);
  return ok({ rule, actions });
}

export async function createAutomationRule(
  db: Db,
  ownerId: string,
  input: CreateAutomationRuleInput,
  signal: AbortSignal,
): Promise<Result<AutomationRule, AppError>> {
  signal.throwIfAborted();
  if (input.actions.length === 0) {
    return err(new AppError(ERROR_IDS.AUTOMATION_RULE_HAS_NO_ACTIONS, "rule has no actions", {}));
  }
  return db.transaction(async (tx) => {
    const [rule] = await tx
      .insert(automationRules)
      .values({
        name: input.name,
        description: input.description,
        pipelineId: input.pipelineId,
        trigger: input.trigger,
        triggerConfig: input.triggerConfig,
        ownerId,
        isActive: input.isActive,
      })
      .returning();
    if (rule === undefined) {
      throw new AppError(
        ERROR_IDS.DB_INSERT_FAILED,
        "createAutomationRule: insert returned no rows",
      );
    }
    await tx.insert(automationRuleActions).values(
      input.actions.map((a, i) => ({
        ruleId: rule.id,
        position: i,
        actionType: a.actionType,
        actionConfig: a.config,
      })),
    );
    return ok(rule);
  });
}

export async function updateAutomationRule(
  db: Db,
  input: UpdateAutomationRuleInput,
  signal: AbortSignal,
): Promise<Result<AutomationRule, AppError>> {
  signal.throwIfAborted();
  if (input.actions.length === 0) {
    return err(new AppError(ERROR_IDS.AUTOMATION_RULE_HAS_NO_ACTIONS, "rule has no actions", {}));
  }
  return db.transaction(async (tx) => {
    const [rule] = await tx
      .update(automationRules)
      .set({
        name: input.name,
        description: input.description,
        pipelineId: input.pipelineId,
        trigger: input.trigger,
        triggerConfig: input.triggerConfig,
      })
      .where(eq(automationRules.id, input.id))
      .returning();
    if (rule === undefined) {
      return err(
        new AppError(ERROR_IDS.AUTOMATION_NOT_FOUND, "automation rule not found", {
          id: input.id,
        }),
      );
    }
    await tx.delete(automationRuleActions).where(eq(automationRuleActions.ruleId, input.id));
    await tx.insert(automationRuleActions).values(
      input.actions.map((a, i) => ({
        ruleId: rule.id,
        position: i,
        actionType: a.actionType,
        actionConfig: a.config,
      })),
    );
    return ok(rule);
  });
}

export async function setAutomationRuleActive(
  db: Db,
  id: string,
  isActive: boolean,
  signal: AbortSignal,
): Promise<Result<AutomationRule, AppError>> {
  signal.throwIfAborted();
  const [rule] = await db
    .update(automationRules)
    .set({ isActive })
    .where(eq(automationRules.id, id))
    .returning();
  if (rule === undefined) {
    return err(new AppError(ERROR_IDS.AUTOMATION_NOT_FOUND, "automation rule not found", { id }));
  }
  return ok(rule);
}

export async function deleteAutomationRule(
  db: Db,
  id: string,
  signal: AbortSignal,
): Promise<Result<true, AppError>> {
  signal.throwIfAborted();
  const [row] = await db.delete(automationRules).where(eq(automationRules.id, id)).returning();
  if (row === undefined) {
    return err(new AppError(ERROR_IDS.AUTOMATION_NOT_FOUND, "automation rule not found", { id }));
  }
  return ok(true);
}
