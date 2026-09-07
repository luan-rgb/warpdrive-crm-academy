# Automations module, Phase 1 (Pipedrive-style trigger → actions)

## Goal

Add an "Automations" feature matching Pipedrive's Automations wizard: a deal-centric
trigger fires a saved rule, which runs an ordered list of actions. This spec covers Phase 1
only: linear trigger → ordered actions, no branching, no "wait for condition" step, no
third-party integrations. Phase 2 (the wait-for-condition step) is a separate spec, built
once Phase 1 is proven, per the explicit two-phase decision made during brainstorming.

## Why Phase 1 excludes the wait step

Pipedrive's real "wait for condition" step is not a simple delay: it waits up to 7 days for
a *second* matching event to occur on the same record, racing against a timeout. If the
event occurs first, the automation continues; if the timeout elapses first, the run is
marked `Expired`. Implementing this correctly requires the engine to track "pending" runs
parked at a wait-step, resolve them from two independent code paths (a new matching trigger
event, or a scheduled timeout job), and support "keep or cancel pending executions" when a
user edits a rule that has runs currently waiting. That's a real subsystem of its own risk
and scope, orthogonal to the core trigger→actions value most users want first.

## Non-goals (Phase 1)

- The wait-for-condition step (Phase 2).
- Any entity besides Deal as the trigger source (no person/organization/activity/lead/project
  triggers, matching this codebase's existing survey: only deal mutations were investigated
  as trigger points).
- Third-party integrations (Slack, Trello, Asana, Microsoft Teams) as actions.
- Per-rule "who can trigger this automation" restriction (Pipedrive has this; Phase 1 relies
  solely on the `automation.manage` gate for who can *create/edit* rules — any user's deal
  mutation can fire any active rule).
- Branching/conditional action paths within a rule (actions always run in a fixed order,
  Phase 1 has no "if/else" step type).

## Architecture

**Trigger evaluation is synchronous and cheap, inline in the existing mutation functions.**
This codebase has no generic event bus; mutations already call multiple side-effect
functions inline (`recordChange`, `publishBoardEvent` in `src/features/deals/dealMove.ts`
and `dealUpdate.ts`). Automation evaluation follows the same pattern: `moveDeal()`,
`updateDeal()`, and deal creation each gain one more inline call,
`evaluateAutomations(db, trigger, dealBefore, dealAfter, signal)`, in
`src/features/automations/evaluate.ts`. This function queries `automation_rules` for active
rules matching `(trigger, pipelineId)` (`pipelineId IS NULL OR pipelineId = deal.pipelineId`)
and, for each match, enqueues one pg-boss job per matched rule — it does no I/O beyond that
query and the enqueue, so it adds negligible latency to the calling mutation.

**Execution is asynchronous, via a pg-boss job**, following the exact pattern in
`src/features/activities/reminders.ts`: a fixed queue name (`PGBOSS_QUEUE_AUTOMATION_EXECUTE
= "automation.execute"` in `src/constants/jobNames.ts`), payload `{ ruleId: string, dealId:
string, trigger: AutomationTrigger }`, `singletonKey` is intentionally *not* set (the same
rule can legitimately fire multiple times for the same deal over its lifetime, unlike a
reminder). The job handler re-reads the rule, its ordered actions, and the current deal state
at execution time (never trusts data captured at enqueue time), runs each action in order,
and writes one `automation_runs` row plus one `automation_run_actions` row per action.

**Actions act as the deal's owner.** Every action (`createActivity`, `createNotification`,
`sendGmail`) requires an actor identity or a connected email account. Phase 1 always resolves
this to the deal's current `ownerId` at execution time (not enqueue time, so a deal
reassigned between trigger and execution acts as the new owner). If the owner has no
connected Gmail account and the action is `send_email`, that one action fails with
`E_AUTOMATION_004` (see Error IDs) while the rest of the run's actions still execute.

## Data model

New file `src/db/schema/automations.ts`:

```ts
export const AUTOMATION_TRIGGERS = [
  "deal_created",
  "deal_stage_changed",
  "deal_status_changed",
  "deal_field_changed",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];
export const automationTrigger = pgEnum("automation_trigger", AUTOMATION_TRIGGERS);

export const AUTOMATION_ACTION_TYPES = [
  "create_activity",
  "send_notification",
  "send_email",
  "update_field",
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

export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // max 120 chars, enforced at the Zod boundary
  description: text("description"), // max 200 chars, enforced at the Zod boundary
  pipelineId: uuid("pipeline_id").references(() => pipelines.id, { onDelete: "cascade" }),
  trigger: automationTrigger("trigger").notNull(),
  // Shape depends on `trigger`:
  //   deal_created: {}
  //   deal_stage_changed: { toStageId: string | null }  (null = fires on any stage change)
  //   deal_status_changed: { toStatus: "won" | "lost" }
  //   deal_field_changed: { fieldKey: string }
  triggerConfig: jsonb("trigger_config").notNull().default(sql`'{}'::jsonb`),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
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
    // e.g. { activityId } | { notificationId } | { messageId } | { fieldKey, oldValue, newValue }
    resultSummary: jsonb("result_summary"),
  },
  (t) => [index("automation_run_actions_run_idx").on(t.runId, t.position)],
);
```

Migration: purely additive (4 new tables + 4 new enums), same convention as every prior
migration in this repo.

## Trigger detection

`evaluateAutomations` is called with a `trigger` the caller already knows (the calling
mutation function determines which trigger fired, not a generic diff):

- **`deal_created`**: called once from the deal-creation function, no `triggerConfig` match
  needed beyond `trigger === "deal_created"`.
- **`deal_stage_changed`**: called from `moveDeal()` after a successful CAS update. Matches
  rules where `triggerConfig.toStageId` is `null` (any stage) or equals the new `stageId`.
- **`deal_status_changed`**: called from `updateDeal()` when `status` transitions to `"won"`
  or `"lost"` (not on every status write — only on an actual open→won/open→lost transition,
  detected by comparing old vs new status). Matches rules where `triggerConfig.toStatus`
  equals the new status.
- **`deal_field_changed`**: called from `updateDeal()` once per changed field (including
  `customFields` keys, compared old vs new). Matches rules where `triggerConfig.fieldKey`
  equals the changed field's key.

All four also filter on `pipelineId IS NULL OR pipelineId = deal.pipelineId` and
`isActive = true`.

## Actions (execution-time behavior)

- **`create_activity`**: calls the existing `createActivity(db, actor, input, signal)` from
  `src/features/activities/repo.ts`, with `actor` resolved to the deal's current owner,
  `assigneeId` = deal owner, `typeId`/`subject` from `actionConfig`, `dealId` = the triggering
  deal.
- **`send_notification`**: calls `createNotification(db, input, signal)` from
  `src/features/notifications/produce.ts`, `recipientId` = deal owner, `entityType`/`entityId`
  = deal, `payload` includes the rendered `messageTemplate`.
- **`send_email`**: resolves the deal owner's connected `EmailAccountRow`; if none exists,
  this action records `status: "error"`, `errorMessage` referencing `E_AUTOMATION_004`, and
  execution continues to the next action. If found, calls `sendGmail(account, message, signal)`
  from `src/features/email/sendSystem.ts`, sending to the deal's linked person's primary
  email (skip with the same error pattern if the deal has no linked person or the person has
  no primary email).
- **`update_field`**: calls the deal update repo function directly (not `updateDeal()`'s
  full action-layer path, to avoid re-triggering `evaluateAutomations` recursively for a
  field this same run is setting — see Error handling below) with `fieldKey`/`value` from
  `actionConfig`.

**Template rendering**: `messageTemplate`/`subjectTemplate`/`bodyTemplate` support simple
`{{deal.title}}`, `{{deal.value}}`, `{{deal.owner}}` placeholder substitution (a plain
string-replace helper in `src/features/automations/template.ts`, not a templating library —
YAGNI: three known placeholders don't need a dependency).

## Error handling and recursion guard

Every action's outcome is recorded independently in `automation_run_actions`; one action's
failure never stops the remaining actions in the same run. The run's overall `status` is
`success` (all actions succeeded), `error` (all actions failed), or `partial` (mixed).

**Recursion guard**: `update_field` actions must not re-trigger `evaluateAutomations` for
the same run (an automation that updates a field matching its own `deal_field_changed`
trigger would otherwise loop). `updateDeal()` in `src/features/deals/dealUpdate.ts` is the
repo function that both the normal user-facing update path AND this action use — today it
calls `evaluateAutomations` unconditionally after a successful write. Phase 1 splits this:
the field-write logic moves into an internal, unexported helper (`applyDealFields()`) that
`updateDeal()` calls and then itself calls `evaluateAutomations` on the result; the
`update_field` action calls `applyDealFields()` directly, skipping `updateDeal()`'s
`evaluateAutomations` call entirely. This means an automation's own field-update action never
fires a *new* automation run, even for a different rule watching that field. This is a
deliberate, documented Phase 1 limitation, not an oversight — chained automations (rule A's
action triggers rule B) are out of scope until a real use case justifies the added complexity
and loop-detection cost.

All operational failures use `Result<T, AppError>`, never `throw`, matching this codebase's
established convention. New error domain in `src/constants/errorIds.ts`:

```
// AUTOMATION
AUTOMATION_INPUT_INVALID: "E_AUTOMATION_001", // create/update rule payload failed the Zod boundary
AUTOMATION_NOT_FOUND: "E_AUTOMATION_002", // rule id does not exist
AUTOMATION_RULE_HAS_NO_ACTIONS: "E_AUTOMATION_003", // attempted to activate a rule with zero actions
AUTOMATION_EMAIL_ACCOUNT_MISSING: "E_AUTOMATION_004", // deal owner has no connected Gmail account
AUTOMATION_EMAIL_RECIPIENT_MISSING: "E_AUTOMATION_005", // deal has no linked person / person has no primary email
```

## Permissions

New flag `"automation.manage"` in `GLOBAL_FLAGS` (`src/constants/permissionFlags.ts`),
`ERROR_IDS`-adjacent constant `AUTOMATION_MANAGE: "automation.manage"`, gated the same way
`product.manage`/`invoice.manage` already are: action-layer `gateAutomationManage` (CSRF →
session → `can(actor, "automation.manage")`), repo functions ungated. Creating/editing/
deleting rules requires this flag; any user's deal mutation can still fire an existing active
rule regardless of that user's own `automation.manage` grant (matching Phase 1's non-goal of
per-rule "who can trigger" restrictions).

## UI

New settings page `src/app/(app)/settings/automations/`, following the established
`page.tsx` (server component, permission gate, data fetch) → `AutomationsClient.tsx` →
`AutomationsTable.tsx` structure from `settings/products/`.

**List view**: table of rules (name, trigger summary, pipeline, active toggle, action count),
"+ Automation" button, per-row link to an execution history view
(`automation_runs` filtered by `ruleId`, paginated, showing status/timestamp/error).

**Creation wizard** (`AutomationWizard.tsx`, likely a multi-step `Dialog` or a dedicated
route `settings/automations/new`, matching Pipedrive's step structure):

1. **Trigger**: entity is fixed to "Deal" (only entity in Phase 1); a `Select` for event type
   (Created / Stage changed / Won or lost / Field changed); a conditional second control
   appears based on the choice (stage picker, won/lost radio, field picker) writing into
   `triggerConfig`.
2. **Pipeline**: `Select` — "All pipelines" or a specific one, writing `pipelineId`.
3. **Actions**: an ordered list with a "+" button opening a menu of the 4 action types; each
   added action renders as a card with its own inline config form (activity type + subject;
   notification message; email subject + body; field + value) and up/down reorder controls
   that update `position`.
4. **Name, description, activate**: `Input` (120 char max), `Textarea` (200 char max),
   `Switch` for `isActive`, "Save" button.

All interactive controls are the existing shadcn/Radix wrappers
(`Select`, `Dialog`, `Input`, `Textarea`, `Switch`) per this repo's hard rule — no hand-rolled
menus or native form controls.

## Testing

TDD, integration tests against real Postgres (no DB mocks), matching every other feature in
this codebase:

- `evaluateAutomations`: one test per trigger type confirming correct matching (including the
  `pipelineId` filter and the `isActive` filter), plus a test confirming a rule with
  `pipelineId: null` matches deals in any pipeline.
- `automation.execute` job handler: runs all 4 action types successfully in order and writes
  correct `automation_runs`/`automation_run_actions` rows; a test where one action fails
  (missing connected Gmail account) confirms the run status is `partial` and later actions
  still ran.
- Recursion guard: an `update_field` action targeting the same field its own rule's
  `deal_field_changed` trigger watches does not enqueue a second `automation.execute` job.
- Permission gate: `automation.manage` on create/update/delete actions.
- `automation_runs.ruleName` snapshot: deleting a rule leaves its prior runs' `ruleName`
  readable (not null/broken) in the history view's query.
