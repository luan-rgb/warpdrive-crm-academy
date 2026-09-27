import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { automationRuleActions, automationRules } from "@/db/schema/automations";

export interface WebhookTarget {
  ruleId: string;
  ruleName: string;
  // Host only: webhook URLs often carry a secret token in the path or query string.
  host: string;
  isActive: boolean;
}

function hostOf(config: unknown): string {
  const url = (config as { url?: unknown }).url;
  if (typeof url !== "string") return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export async function listWebhookTargets(db: Db, signal: AbortSignal): Promise<WebhookTarget[]> {
  signal.throwIfAborted();
  const rows = await db
    .select({
      ruleId: automationRules.id,
      ruleName: automationRules.name,
      isActive: automationRules.isActive,
      config: automationRuleActions.actionConfig,
    })
    .from(automationRuleActions)
    .innerJoin(automationRules, eq(automationRules.id, automationRuleActions.ruleId))
    .where(eq(automationRuleActions.actionType, "webhook"))
    .orderBy(asc(automationRules.name), asc(automationRuleActions.position));
  return rows.map((r) => ({
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    host: hostOf(r.config),
    isActive: r.isActive,
  }));
}
