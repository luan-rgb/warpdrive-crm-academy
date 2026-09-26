import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { deals } from "./deals";
import { users } from "./identity";
import { pipelines } from "./pipelines";

export const AUTOMATION_TRIGGERS = [
  "deal_created",
  "deal_stage_changed",
  "deal_status_changed",
  "deal_field_changed",
  // Activities linked to a deal (the run targets that deal). Only user-created/completed
  // activities fire these: activities an automation creates never re-trigger automations.
  "activity_created",
  "activity_completed",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];
export const automationTrigger = pgEnum("automation_trigger", AUTOMATION_TRIGGERS);

export const AUTOMATION_ACTION_TYPES = [
  "create_activity",
  "send_notification",
  "send_email",
  "update_field",
  "add_note",
  "webhook",
] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];
export const automationActionType = pgEnum("automation_action_type", AUTOMATION_ACTION_TYPES);

export const AUTOMATION_RUN_STATUS = ["success", "error", "partial"] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUS)[number];
export const automationRunStatus = pgEnum("automation_run_status", AUTOMATION_RUN_STATUS);

export const AUTOMATION_RUN_ACTION_STATUS = ["success", "error", "skipped"] as const;
export type AutomationRunActionStatus = (typeof AUTOMATION_RUN_ACTION_STATUS)[number];
export const automationRunActionStatus = pgEnum(
  "automation_run_action_status",
  AUTOMATION_RUN_ACTION_STATUS,
);

// A saved trigger→actions rule (Pipedrive "Automation"). Not a fiscal or historical document,
// so no snapshot pattern here — unlike invoices, editing a rule changes future behavior only;
// past executions are preserved separately in automation_runs via a name snapshot.
export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  // null = fires for deals in any pipeline.
  pipelineId: uuid("pipeline_id").references(() => pipelines.id, { onDelete: "cascade" }),
  trigger: automationTrigger("trigger").notNull(),
  // Shape depends on `trigger`:
  //   deal_created: {}
  //   deal_stage_changed: { toStageId: string | null }  (null = any stage change)
  //   deal_status_changed: { toStatus: "won" | "lost" }
  //   deal_field_changed: { fieldKey: string }  (change-log field key: "title", "value",
  //     "custom_field:<key>", etc. — see src/constants/changeLogFields.ts)
  triggerConfig: jsonb("trigger_config").notNull().default(sql`'{}'::jsonb`),
  // Optional AND-filters on the deal (features/automations/conditions.ts); [] = always fire.
  conditions: jsonb("conditions").notNull().default(sql`'[]'::jsonb`),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const automationRuleActions = pgTable(
  "automation_rule_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    actionType: automationActionType("action_type").notNull(),
    // Shape depends on `actionType`:
    //   create_activity: { activityTypeId: string, subject: string }
    //   send_notification: { messageTemplate: string }
    //   send_email: { subjectTemplate: string, bodyTemplate: string }
    //   update_field: { fieldKey: string, value: string }
    //     (fieldKey in AUTOMATION_UPDATE_FIELDS: title, value, stageId, ownerId,
    //     expectedCloseDate)
    //   send_notification may also carry { recipientId: string } (default: the deal owner)
    //   add_note: { contentTemplate: string }
    //   webhook: { url: string } (public http(s) URL; private/internal hosts are refused)
    actionConfig: jsonb("action_config").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("automation_rule_actions_rule_idx").on(t.ruleId, t.position)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id").references(() => automationRules.id, { onDelete: "set null" }),
    // Snapshotted so history stays readable after the rule is renamed or deleted.
    ruleName: text("rule_name").notNull(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    trigger: automationTrigger("trigger").notNull(),
    status: automationRunStatus("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("automation_runs_rule_idx").on(t.ruleId, t.startedAt),
    index("automation_runs_deal_idx").on(t.dealId, t.startedAt),
  ],
);

export const automationRunActions = pgTable(
  "automation_run_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    actionType: automationActionType("action_type").notNull(),
    status: automationRunActionStatus("status").notNull(),
    errorMessage: text("error_message"),
    resultSummary: jsonb("result_summary"),
  },
  (t) => [index("automation_run_actions_run_idx").on(t.runId, t.position)],
);

export type AutomationRule = typeof automationRules.$inferSelect;
export type NewAutomationRule = typeof automationRules.$inferInsert;
export type AutomationRuleAction = typeof automationRuleActions.$inferSelect;
export type NewAutomationRuleAction = typeof automationRuleActions.$inferInsert;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type NewAutomationRun = typeof automationRuns.$inferInsert;
export type AutomationRunAction = typeof automationRunActions.$inferSelect;
export type NewAutomationRunAction = typeof automationRunActions.$inferInsert;
