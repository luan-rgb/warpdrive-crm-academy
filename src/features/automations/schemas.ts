import { z } from "zod";
import { AUTOMATION_ACTION_TYPES, AUTOMATION_TRIGGERS } from "@/db/schema/automations";
import { AUTOMATION_UPDATE_FIELD_ALLOWED } from "./actionRunners";

// One action within a rule's ordered action list. `config` shape is validated loosely here
// (a record) — the job handler validates the shape it needs per actionType at execution time,
// the same "validate what you read, when you read it" split invoicesRepo uses for jsonb
// columns whose shape depends on a sibling enum column.
export const automationRuleActionInputSchema = z.object({
  actionType: z.enum(AUTOMATION_ACTION_TYPES),
  config: z.record(z.string(), z.unknown()),
});
export type AutomationRuleActionInput = z.infer<typeof automationRuleActionInputSchema>;

// Cross-field checks that would otherwise fail silently: an update_field action whose fieldKey
// runUpdateField does not support saves fine and only errors at execution time
// (E_AUTOMATION_001 in a run-actions row nothing surfaces to the user); a deal_field_changed
// trigger with a blank/missing fieldKey saves a rule that can never fire. Shared by
// create/update since both schemas carry the same trigger/triggerConfig/actions shape.
function refineTriggerAndActionConfigs(
  input: {
    trigger: string;
    triggerConfig: Record<string, unknown>;
    actions: AutomationRuleActionInput[];
  },
  ctx: z.RefinementCtx,
): void {
  if (input.trigger === "deal_field_changed") {
    const fieldKey = input.triggerConfig.fieldKey;
    if (typeof fieldKey !== "string" || fieldKey.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["triggerConfig", "fieldKey"],
        message: "deal_field_changed requires a non-empty triggerConfig.fieldKey",
      });
    }
  }

  input.actions.forEach((action, i) => {
    if (action.actionType !== "update_field") return;
    const fieldKey = action.config.fieldKey;
    if (typeof fieldKey !== "string" || !(fieldKey in AUTOMATION_UPDATE_FIELD_ALLOWED)) {
      ctx.addIssue({
        code: "custom",
        path: ["actions", i, "config", "fieldKey"],
        message: `update_field actionConfig.fieldKey must be one of: ${Object.keys(AUTOMATION_UPDATE_FIELD_ALLOWED).join(", ")}`,
      });
    }
  });
}

export const createAutomationRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(200).nullable().default(null),
    pipelineId: z.string().uuid().nullable().default(null),
    trigger: z.enum(AUTOMATION_TRIGGERS),
    triggerConfig: z.record(z.string(), z.unknown()).default({}),
    actions: z.array(automationRuleActionInputSchema).min(1),
    isActive: z.boolean().default(true),
  })
  .superRefine(refineTriggerAndActionConfigs);
export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleInputSchema>;

export const updateAutomationRuleInputSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(200).nullable().default(null),
    pipelineId: z.string().uuid().nullable().default(null),
    trigger: z.enum(AUTOMATION_TRIGGERS),
    triggerConfig: z.record(z.string(), z.unknown()).default({}),
    actions: z.array(automationRuleActionInputSchema).min(1),
  })
  .superRefine(refineTriggerAndActionConfigs);
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleInputSchema>;

export const setAutomationRuleActiveInputSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

export const deleteAutomationRuleInputSchema = z.object({ id: z.string().uuid() });
