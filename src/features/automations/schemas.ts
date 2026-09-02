import { z } from "zod";
import { AUTOMATION_ACTION_TYPES, AUTOMATION_TRIGGERS } from "@/db/schema/automations";

// One action within a rule's ordered action list. `config` shape is validated loosely here
// (a record) — the job handler validates the shape it needs per actionType at execution time,
// the same "validate what you read, when you read it" split invoicesRepo uses for jsonb
// columns whose shape depends on a sibling enum column.
export const automationRuleActionInputSchema = z.object({
  actionType: z.enum(AUTOMATION_ACTION_TYPES),
  config: z.record(z.string(), z.unknown()),
});
export type AutomationRuleActionInput = z.infer<typeof automationRuleActionInputSchema>;

export const createAutomationRuleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(200).nullable().default(null),
  pipelineId: z.string().uuid().nullable().default(null),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  triggerConfig: z.record(z.string(), z.unknown()).default({}),
  actions: z.array(automationRuleActionInputSchema).min(1),
  isActive: z.boolean().default(true),
});
export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleInputSchema>;

export const updateAutomationRuleInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(200).nullable().default(null),
  pipelineId: z.string().uuid().nullable().default(null),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  triggerConfig: z.record(z.string(), z.unknown()).default({}),
  actions: z.array(automationRuleActionInputSchema).min(1),
});
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleInputSchema>;

export const setAutomationRuleActiveInputSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

export const deleteAutomationRuleInputSchema = z.object({ id: z.string().uuid() });
