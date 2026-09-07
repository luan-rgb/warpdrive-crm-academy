# Automations Module Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pipedrive-style "Automations" feature: admin-managed rules that fire on one of
four deal triggers (created, stage changed, won/lost, field changed), optionally scoped to a
pipeline, and run an ordered list of actions (create activity, notify, send email, update
field), with a persisted execution log.

**Architecture:** Trigger evaluation is synchronous and inline in the existing deal-mutation
functions (`createDeal`, `moveDeal`, `updateDeal`), matching this codebase's established
pattern of calling side-effect functions (`recordChange`, `publishBoardEvent`) directly inside
those functions rather than through a generic event bus, which doesn't exist here. Evaluation
only queries for matching active rules and enqueues one pg-boss job per match — no action
logic runs inline. Execution is asynchronous via a new `automation.execute` pg-boss queue,
following the exact job pattern in `src/features/activities/reminders.ts`: the job re-reads
the rule and the deal at fire time, runs each action in order acting as the deal's current
owner, and writes one `automation_runs` row plus one `automation_run_actions` row per action.

**Tech Stack:** Next.js App Router, Drizzle ORM + Postgres, tRPC, Zod, pg-boss, Vitest
(`unit` + `integration` projects), shadcn/ui + Radix, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-02-automations-phase1-design.md`

## Global Constraints

- Test-first: every step that adds behavior starts with a failing test (CLAUDE.md,
  "Test-Driven Development (required)").
- No DB mocks: integration tests run against a real Postgres via `withTestDb`.
- External data validated once at the Zod boundary; repo functions trust their input type.
- Operational failures are `Result<T, AppError>` values, never `throw` — throw only for
  programmer-error invariants (matching every existing repo function surveyed for this plan).
- Every `AppError` carries a stable `E_<DOMAIN>_<NNN>` id from `src/constants/errorIds.ts`;
  never reuse a retired id, always append.
- No native form controls, no hand-rolled menus/dialogs — only the shadcn/Radix wrappers in
  `src/components/ui/`.
- `signal.throwIfAborted()` after every await that isn't itself signal-aware.
- No unrequested abstractions: no chained multi-condition rule steps, no "wait for condition"
  step, no third-party integrations, no non-deal trigger entities — all explicitly deferred
  per the spec's Non-goals.
- Biome + ESLint clean (`pnpm lint`) and `pnpm typecheck` clean before each commit.

---

## Task 1: Schema — automation tables and enums

**Files:**
- Create: `src/db/schema/automations.ts`
- Modify: `src/db/schema/index.ts` (add `export * from "./automations";`)
- Create: `drizzle/00NN_<generated_name>.sql` (via `pnpm db:generate`)

**Interfaces:**
- Produces: `AUTOMATION_TRIGGERS`, `AutomationTrigger`, `automationTrigger` (pg enum);
  `AUTOMATION_ACTION_TYPES`, `AutomationActionType`, `automationActionType`;
  `AUTOMATION_RUN_STATUS`, `AutomationRunStatus`, `automationRunStatus`;
  `AUTOMATION_RUN_ACTION_STATUS`, `AutomationRunActionStatus`, `automationRunActionStatus`;
  tables `automationRules`, `automationRuleActions`, `automationRuns`, `automationRunActions`
  with their `$inferSelect`/`$inferInsert` types (`AutomationRule`, `NewAutomationRule`,
  `AutomationRuleAction`, `NewAutomationRuleAction`, `AutomationRun`, `NewAutomationRun`,
  `AutomationRunAction`, `NewAutomationRunAction`). Every later task imports from this file.

- [ ] **Step 1: Write `src/db/schema/automations.ts`**

```ts
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
import { pipelines } from "./pipelines";
import { users } from "./identity";

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
```

- [ ] **Step 2: Add the barrel export**

In `src/db/schema/index.ts`, add (alphabetically, near the top with the other `a`-prefixed
exports): `export * from "./automations";`

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`

Expected: a new `drizzle/00NN_<name>.sql` and `drizzle/meta/00NN_snapshot.json` appear,
containing 4 `CREATE TYPE` statements and 4 `CREATE TABLE` statements, purely additive. Read
the generated SQL to confirm no drops/renames.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (nothing imports this new file yet).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/automations.ts src/db/schema/index.ts drizzle/
git commit -m "feat(automations): add automation_rules/rule_actions/runs/run_actions schema"
```

---

## Task 2: Zod schemas, error IDs, permission flag

**Files:**
- Create: `src/features/automations/schemas.ts`
- Modify: `src/constants/errorIds.ts`
- Modify: `src/constants/permissionFlags.ts`
- Modify: `src/constants/notificationTypes.ts`

**Interfaces:**
- Consumes: `AUTOMATION_TRIGGERS`, `AUTOMATION_ACTION_TYPES` from `@/db/schema/automations`
  (Task 1).
- Produces: `createAutomationRuleInputSchema`, `updateAutomationRuleInputSchema`,
  `deleteAutomationRuleInputSchema`, `setAutomationRuleActiveInputSchema`,
  `automationRuleActionInputSchema` (used as an array field inside create/update),
  `CreateAutomationRuleInput`, `UpdateAutomationRuleInput` types. `ERROR_IDS.AUTOMATION_*`
  constants. `"automation.manage"` added to `GLOBAL_FLAGS`. `"automation"` added to
  `NOTIFICATION_TYPES`. Task 3's repo functions and Task 6's actions/router import all of the
  above.

- [ ] **Step 1: Write `src/features/automations/schemas.ts`**

```ts
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
```

- [ ] **Step 2: Add error IDs**

In `src/constants/errorIds.ts`, find the last domain block (search for `// ENRICH` or the
final domain comment before `// UI`) and append a new block immediately before `// UI` (append,
never renumber existing ids):

```ts
  // AUTOMATION
  AUTOMATION_INPUT_INVALID: "E_AUTOMATION_001", // create/update rule payload failed the Zod boundary
  AUTOMATION_NOT_FOUND: "E_AUTOMATION_002", // rule id does not exist
  AUTOMATION_RULE_HAS_NO_ACTIONS: "E_AUTOMATION_003", // attempted to save a rule with zero actions
  AUTOMATION_EMAIL_ACCOUNT_MISSING: "E_AUTOMATION_004", // deal owner has no connected Gmail account
  AUTOMATION_EMAIL_RECIPIENT_MISSING: "E_AUTOMATION_005", // deal has no linked person / person has no primary email
```

- [ ] **Step 3: Add the permission flag**

In `src/constants/permissionFlags.ts`, add `"automation.manage"` to the `GLOBAL_FLAGS` array
(alongside `"product.manage"`, `"invoice.manage"`), and add
`AUTOMATION_MANAGE: "automation.manage"` to the flag-constant object below it (mirroring
`PRODUCT_MANAGE`/`INVOICE_MANAGE`).

- [ ] **Step 4: Add the notification type**

In `src/constants/notificationTypes.ts`, append `"automation"` to the `NOTIFICATION_TYPES`
array (after `"deal_email_received"`).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/automations/schemas.ts src/constants/errorIds.ts src/constants/permissionFlags.ts src/constants/notificationTypes.ts
git commit -m "feat(automations): add Zod schemas, error ids, permission flag, notification type"
```

---

## Task 3: Trigger evaluation core + wiring into deal mutations

**Files:**
- Create: `src/features/automations/evaluate.ts`
- Create: `src/features/automations/evaluate.test.ts`
- Modify: `src/features/deals/dealActions.ts` (createDeal)
- Modify: `src/features/deals/dealMove.ts` (moveDeal)
- Modify: `src/features/deals/dealUpdate.ts` (updateDeal)
- Modify: `src/features/deals/dealUpdateChangeLog.ts` (return the changes array)
- Create: `src/constants/jobNames.ts` (modify — add the queue name constant)

**Interfaces:**
- Consumes: `AutomationTrigger` from `@/db/schema/automations` (Task 1).
- Produces: `matchAutomationRules(db: DbOrTx, trigger: AutomationTrigger, dealBefore: Deal |
  null, dealAfter: Deal, signal: AbortSignal, fieldChanges?: DealFieldChange[]):
  Promise<AutomationRule[]>` — the matching logic, pure DB read, no pg-boss involved, fully
  testable against real Postgres. `evaluateAutomations(db: DbOrTx, trigger: AutomationTrigger,
  dealBefore: Deal | null, dealAfter: Deal, signal: AbortSignal, fieldChanges?:
  DealFieldChange[]): Promise<void>` — the entry point every deal-mutation function calls:
  calls `matchAutomationRules` then enqueues one job per match via `requireBoss()`. This thin
  wrapper is intentionally NOT covered by its own test — this codebase's established
  convention (`src/features/activities/reminders.ts`'s producer `scheduleReminder`, see
  `reminders.test.ts`) never tests a pg-boss producer function directly, because
  `getBoss()`/`requireBoss()` returns `null` in the test environment (test/script processes
  never call `setBoss()`), so a producer function no-ops there with nothing meaningful to
  assert. Tests instead cover the matching logic (`matchAutomationRules`, pure DB) and the job
  consumer (`handleAutomationExecuteJob` in Task 5, called directly with fake job data) — the
  same split `reminders.ts`/`reminders.test.ts` already uses. `PGBOSS_QUEUE_AUTOMATION_EXECUTE`
  constant. Task 5's job handler consumes jobs enqueued here (the payload shape:
  `{ ruleId: string, dealId: string, trigger: AutomationTrigger }`).

- [ ] **Step 1: Add the queue name constant**

In `src/constants/jobNames.ts`, append:

```ts
// Automation rule execution: one job per (rule, deal) match, enqueued by evaluateAutomations,
// consumed by the automation.execute worker (Task 4). No singletonKey: the same rule legitimately
// fires more than once for the same deal over its lifetime (e.g. re-entering a stage).
export const PGBOSS_QUEUE_AUTOMATION_EXECUTE = "automation.execute";
```

- [ ] **Step 2: Write the failing tests for `matchAutomationRules`**

Create `src/features/automations/evaluate.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { matchAutomationRules } from "./evaluate";

const sig = () => new AbortController().signal;

async function seedDeal(
  db: Db,
  ownerId: string,
  pipelineId: string,
  stageId: string,
  status: "open" | "won" | "lost" = "open",
): Promise<{ id: string; [k: string]: unknown }> {
  const row = (
    await db.execute(sql`
      INSERT INTO deals (title, pipeline_id, stage_id, owner_id, visibility_level, status)
      VALUES ('Test Deal', ${pipelineId}, ${stageId}, ${ownerId}, 'all', ${status})
      RETURNING *
    `)
  ).rows[0] as { id: string; [k: string]: unknown } | undefined;
  if (row === undefined) throw new Error("seedDeal: no row");
  return row;
}

async function seedRule(
  db: Db,
  ownerId: string,
  opts: {
    trigger: string;
    triggerConfig?: Record<string, unknown>;
    pipelineId?: string | null;
    isActive?: boolean;
  },
): Promise<string> {
  const row = (
    await db.execute(sql`
      INSERT INTO automation_rules (name, pipeline_id, trigger, trigger_config, owner_id, is_active)
      VALUES (
        'Test Rule',
        ${opts.pipelineId ?? null},
        ${opts.trigger},
        ${JSON.stringify(opts.triggerConfig ?? {})}::jsonb,
        ${ownerId},
        ${opts.isActive ?? true}
      )
      RETURNING id
    `)
  ).rows[0] as { id: string } | undefined;
  if (row === undefined) throw new Error("seedRule: no row");
  return row.id;
}

it("matches a deal_created rule with no pipeline filter", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const ruleId = await seedRule(db, user.id, { trigger: "deal_created" });
    const deal = await seedDeal(db, user.id, pipeline.id, stage.id);

    const matched = await matchAutomationRules(db, "deal_created", null, deal as never, sig());

    expect(matched.map((r) => r.id)).toEqual([ruleId]);
  });
});

it("does not match a rule scoped to a different pipeline", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline: p1, stages: s1 } = await seedPipelineWithStages(db, ["Open"]);
    const { pipeline: p2 } = await seedPipelineWithStages(db, ["Open"]);
    const stage1 = s1[0];
    if (stage1 === undefined) throw new Error("no stage");
    await seedRule(db, user.id, { trigger: "deal_created", pipelineId: p2.id });
    const deal = await seedDeal(db, user.id, p1.id, stage1.id);

    const matched = await matchAutomationRules(db, "deal_created", null, deal as never, sig());

    expect(matched).toHaveLength(0);
  });
});

it("matches deal_stage_changed only when toStageId matches", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open", "Qualified"]);
    const [stageA, stageB] = stages;
    if (stageA === undefined || stageB === undefined) throw new Error("need 2 stages");
    const ruleId = await seedRule(db, user.id, {
      trigger: "deal_stage_changed",
      triggerConfig: { toStageId: stageB.id },
    });
    const dealBefore = await seedDeal(db, user.id, pipeline.id, stageA.id);
    const dealAfter = { ...dealBefore, stageId: stageB.id };

    const matched = await matchAutomationRules(
      db,
      "deal_stage_changed",
      dealBefore as never,
      dealAfter as never,
      sig(),
    );

    expect(matched.map((r) => r.id)).toEqual([ruleId]);
  });
});

it("matches deal_stage_changed for any stage when toStageId is null", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open", "Qualified"]);
    const [stageA, stageB] = stages;
    if (stageA === undefined || stageB === undefined) throw new Error("need 2 stages");
    const ruleId = await seedRule(db, user.id, {
      trigger: "deal_stage_changed",
      triggerConfig: { toStageId: null },
    });
    const dealBefore = await seedDeal(db, user.id, pipeline.id, stageA.id);
    const dealAfter = { ...dealBefore, stageId: stageB.id };

    const matched = await matchAutomationRules(
      db,
      "deal_stage_changed",
      dealBefore as never,
      dealAfter as never,
      sig(),
    );

    expect(matched.map((r) => r.id)).toEqual([ruleId]);
  });
});

it("does not match deal_stage_changed on an intra-column no-op (same stage)", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    await seedRule(db, user.id, { trigger: "deal_stage_changed", triggerConfig: { toStageId: null } });
    const deal = await seedDeal(db, user.id, pipeline.id, stage.id);

    const matched = await matchAutomationRules(
      db,
      "deal_stage_changed",
      deal as never,
      deal as never,
      sig(),
    );

    expect(matched).toHaveLength(0);
  });
});

it("matches deal_status_changed only for the configured status", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const ruleId = await seedRule(db, user.id, {
      trigger: "deal_status_changed",
      triggerConfig: { toStatus: "won" },
    });
    const dealBefore = await seedDeal(db, user.id, pipeline.id, stage.id, "open");
    const wonDeal = { ...dealBefore, status: "won" };
    const lostDeal = { ...dealBefore, status: "lost" };

    const wonMatch = await matchAutomationRules(
      db,
      "deal_status_changed",
      dealBefore as never,
      wonDeal as never,
      sig(),
    );
    const lostMatch = await matchAutomationRules(
      db,
      "deal_status_changed",
      dealBefore as never,
      lostDeal as never,
      sig(),
    );

    expect(wonMatch.map((r) => r.id)).toEqual([ruleId]);
    expect(lostMatch).toHaveLength(0);
  });
});

it("matches deal_field_changed only for the configured field key", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const ruleId = await seedRule(db, user.id, {
      trigger: "deal_field_changed",
      triggerConfig: { fieldKey: "title" },
    });
    const dealBefore = await seedDeal(db, user.id, pipeline.id, stage.id);
    const dealAfter = { ...dealBefore, title: "New Title" };

    const titleMatch = await matchAutomationRules(
      db,
      "deal_field_changed",
      dealBefore as never,
      dealAfter as never,
      sig(),
      [{ field: "title", oldValue: "Test Deal", newValue: "New Title" }],
    );
    const valueMatch = await matchAutomationRules(
      db,
      "deal_field_changed",
      dealBefore as never,
      dealAfter as never,
      sig(),
      [{ field: "value", oldValue: null, newValue: "100.00" }],
    );

    expect(titleMatch.map((r) => r.id)).toEqual([ruleId]);
    expect(valueMatch).toHaveLength(0);
  });
});

it("does not match an inactive rule", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    await seedRule(db, user.id, { trigger: "deal_created", isActive: false });
    const deal = await seedDeal(db, user.id, pipeline.id, stage.id);

    const matched = await matchAutomationRules(db, "deal_created", null, deal as never, sig());

    expect(matched).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test:integration -- evaluate`
Expected: FAIL — `matchAutomationRules` does not exist yet.

- [ ] **Step 4: Write `src/features/automations/evaluate.ts`**

```ts
import { and, eq, isNull, or } from "drizzle-orm";
import { PGBOSS_QUEUE_AUTOMATION_EXECUTE } from "@/constants/jobNames";
import type { Deal } from "@/db/schema/deals";
import { type AutomationRule, type AutomationTrigger, automationRules } from "@/db/schema/automations";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { requireBoss } from "@/jobs/requireBoss";

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
        or(isNull(automationRules.pipelineId), eq(automationRules.pipelineId, dealAfter.pipelineId)),
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
  const matched = await matchAutomationRules(db, trigger, dealBefore, dealAfter, signal, fieldChanges);
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:integration -- evaluate`
Expected: PASS, all 8 tests.

- [ ] **Step 6: Refactor `logDealUpdateChanges` to return the changes it writes**

In `src/features/deals/dealUpdateChangeLog.ts`, change the function signature and final loop:

```ts
export async function logDealUpdateChanges(
  tx: DbOrTx,
  args: { input: DealUpdateInput; before: DealRow; after: DealRow; actorId: string },
  signal: AbortSignal,
): Promise<{ field: string; oldValue: unknown; newValue: unknown }[]> {
  const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];

  // Labels: order-insensitive array compare (reorder of the same set is a no-op).
  if (args.input.labels !== undefined && !arraysEqual(args.before.labels, args.after.labels)) {
    changes.push({ field: "labels", oldValue: args.before.labels, newValue: args.after.labels });
  }
  if (
    args.input.sourceChannel !== undefined &&
    args.before.sourceChannel !== args.after.sourceChannel
  ) {
    changes.push({
      field: "source_channel",
      oldValue: args.before.sourceChannel,
      newValue: args.after.sourceChannel,
    });
  }
  changes.push(...scalarChanges(args.input, args.before, args.after));
  changes.push(...customFieldChanges(args.input, args.before));

  for (const change of changes) {
    await recordChange(
      tx,
      {
        entityType: "deal",
        entityId: args.after.id,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        actorId: args.actorId,
      },
      signal,
    );
  }

  return changes;
}
```

(Only the signature's return type and the final `return changes;` are new — the body is
otherwise unchanged.)

- [ ] **Step 7: Wire `evaluateAutomations` into `createDeal`**

In `src/features/deals/dealActions.ts`, add the import:

```ts
import { evaluateAutomations } from "@/features/automations/evaluate";
```

Inside `createDeal`'s transaction, right after the existing `await publishBoardEvent(...)` call
and before `return ok(row);`, add:

```ts
    await evaluateAutomations(tx, "deal_created", null, row, signal);

    return ok(row);
```

- [ ] **Step 8: Wire `evaluateAutomations` into `moveDeal`**

In `src/features/deals/dealMove.ts`, add the import:

```ts
import { evaluateAutomations } from "@/features/automations/evaluate";
```

Right after the existing `await publishBoardEvent(...)` call and before `return ok(row);`, add:

```ts
    if (row.stageId !== deal.stageId) {
      await evaluateAutomations(tx, "deal_stage_changed", deal, row, signal);
    }

    return ok(row);
```

(Mirrors the existing `if (row.stageId !== deal.stageId)` guard already used a few lines above
for `recordChange` — evaluate only on an actual stage change, not an intra-column reorder.)

- [ ] **Step 9: Wire `evaluateAutomations` into `updateDeal`**

In `src/features/deals/dealUpdate.ts`, add the import:

```ts
import { evaluateAutomations } from "@/features/automations/evaluate";
```

Change the existing line:

```ts
    await logDealUpdateChanges(tx, { input, before, after: row, actorId: session.id }, signal);
```

to capture the return value:

```ts
    const changes = await logDealUpdateChanges(
      tx,
      { input, before, after: row, actorId: session.id },
      signal,
    );
```

Then, right after the existing `await publishBoardEvent(...)` call and before `return
ok(row);`, add:

```ts
    if (input.status !== undefined && before.status !== row.status) {
      await evaluateAutomations(tx, "deal_status_changed", before, row, signal);
    }
    if (changes.length > 0) {
      await evaluateAutomations(tx, "deal_field_changed", before, row, signal, changes);
    }

    return ok(row);
```

- [ ] **Step 10: Typecheck and run the full deals + automations test suites**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test:integration -- evaluate dealMove dealUpdate dealActions`
Expected: PASS, no regressions in the existing deal-mutation tests (they don't seed any
`automation_rules` rows, so `evaluateAutomations` finds zero matches and is a no-op for them).

- [ ] **Step 11: Commit**

```bash
git add src/features/automations/evaluate.ts src/features/automations/evaluate.test.ts src/constants/jobNames.ts src/features/deals/dealActions.ts src/features/deals/dealMove.ts src/features/deals/dealUpdate.ts src/features/deals/dealUpdateChangeLog.ts
git commit -m "feat(automations): add trigger evaluation, wire into deal create/move/update"
```

---

## Task 4: Rule CRUD repo functions

**Files:**
- Create: `src/features/automations/rulesRepo.ts`
- Create: `src/features/automations/rulesRepo.test.ts`

**Interfaces:**
- Consumes: `CreateAutomationRuleInput`, `UpdateAutomationRuleInput` from `./schemas` (Task 2);
  `automationRules`, `automationRuleActions`, `AutomationRule`, `AutomationRuleAction` from
  `@/db/schema/automations` (Task 1).
- Produces: `listAutomationRules(db, signal): Promise<AutomationRule[]>`,
  `getAutomationRule(db, id, signal): Promise<Result<{ rule: AutomationRule; actions:
  AutomationRuleAction[] }, AppError>>`, `createAutomationRule(db, ownerId: string, input:
  CreateAutomationRuleInput, signal): Promise<Result<AutomationRule, AppError>>`,
  `updateAutomationRule(db, input: UpdateAutomationRuleInput, signal): Promise<Result<
  AutomationRule, AppError>>`, `setAutomationRuleActive(db, id: string, isActive: boolean,
  signal): Promise<Result<AutomationRule, AppError>>`, `deleteAutomationRule(db, id: string,
  signal): Promise<Result<true, AppError>>`. Task 6's actions.ts calls all of these; Task 7/8's
  UI consumes the shapes they return.

- [ ] **Step 1: Write the failing tests**

Create `src/features/automations/rulesRepo.test.ts`:

```ts
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import {
  createAutomationRule,
  deleteAutomationRule,
  getAutomationRule,
  listAutomationRules,
  setAutomationRuleActive,
  updateAutomationRule,
} from "./rulesRepo";

const sig = () => new AbortController().signal;

it("creates a rule with its ordered actions", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const result = await createAutomationRule(
      db,
      user.id,
      {
        name: "Notify on stage change",
        description: null,
        pipelineId: null,
        trigger: "deal_stage_changed",
        triggerConfig: { toStageId: null },
        actions: [
          { actionType: "send_notification", config: { messageTemplate: "Deal moved" } },
          { actionType: "create_activity", config: { activityTypeId: "x", subject: "Follow up" } },
        ],
        isActive: true,
      },
      sig(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Notify on stage change");

    const fetched = await getAutomationRule(db, result.value.id, sig());
    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(fetched.value.actions).toHaveLength(2);
      expect(fetched.value.actions[0]?.position).toBe(0);
      expect(fetched.value.actions[1]?.position).toBe(1);
    }
  });
});

it("rejects creating a rule with zero actions", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    // The Zod boundary (actions: z.array(...).min(1)) is the real gate; this test exercises
    // the repo's own defense in depth in case a caller bypasses .parse() with a hand-built object.
    const result = await createAutomationRule(
      db,
      user.id,
      {
        name: "No actions",
        description: null,
        pipelineId: null,
        trigger: "deal_created",
        triggerConfig: {},
        actions: [],
        isActive: true,
      },
      sig(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.id).toBe("E_AUTOMATION_003");
  });
});

it("replaces a rule's actions on update", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const created = await createAutomationRule(
      db,
      user.id,
      {
        name: "Original",
        description: null,
        pipelineId: null,
        trigger: "deal_created",
        triggerConfig: {},
        actions: [{ actionType: "send_notification", config: { messageTemplate: "hi" } }],
        isActive: true,
      },
      sig(),
    );
    if (!created.ok) throw new Error("setup failed");

    const updated = await updateAutomationRule(
      db,
      {
        id: created.value.id,
        name: "Renamed",
        description: null,
        pipelineId: null,
        trigger: "deal_created",
        triggerConfig: {},
        actions: [
          { actionType: "create_activity", config: { activityTypeId: "x", subject: "Call" } },
        ],
      },
      sig(),
    );
    expect(updated.ok).toBe(true);

    const fetched = await getAutomationRule(db, created.value.id, sig());
    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(fetched.value.rule.name).toBe("Renamed");
      expect(fetched.value.actions).toHaveLength(1);
      expect(fetched.value.actions[0]?.actionType).toBe("create_activity");
    }
  });
});

it("toggles a rule's active flag", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const created = await createAutomationRule(
      db,
      user.id,
      {
        name: "Toggle me",
        description: null,
        pipelineId: null,
        trigger: "deal_created",
        triggerConfig: {},
        actions: [{ actionType: "send_notification", config: {} }],
        isActive: true,
      },
      sig(),
    );
    if (!created.ok) throw new Error("setup failed");

    const off = await setAutomationRuleActive(db, created.value.id, false, sig());
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.value.isActive).toBe(false);
  });
});

it("lists rules and deletes one", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const created = await createAutomationRule(
      db,
      user.id,
      {
        name: "To delete",
        description: null,
        pipelineId: null,
        trigger: "deal_created",
        triggerConfig: {},
        actions: [{ actionType: "send_notification", config: {} }],
        isActive: true,
      },
      sig(),
    );
    if (!created.ok) throw new Error("setup failed");

    const before = await listAutomationRules(db, sig());
    expect(before.some((r) => r.id === created.value.id)).toBe(true);

    const deleted = await deleteAutomationRule(db, created.value.id, sig());
    expect(deleted.ok).toBe(true);

    const after = await listAutomationRules(db, sig());
    expect(after.some((r) => r.id === created.value.id)).toBe(false);
  });
});

it("returns AUTOMATION_NOT_FOUND for a missing rule id", async () => {
  await withTestDb(async (db) => {
    const result = await getAutomationRule(db, "00000000-0000-0000-0000-000000000000", sig());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.id).toBe("E_AUTOMATION_002");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:integration -- rulesRepo`
Expected: FAIL — `./rulesRepo` does not exist.

- [ ] **Step 3: Write `src/features/automations/rulesRepo.ts`**

```ts
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
    return err(
      new AppError(ERROR_IDS.AUTOMATION_RULE_HAS_NO_ACTIONS, "rule has no actions", {}),
    );
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
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "createAutomationRule: insert returned no rows");
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
    return err(
      new AppError(ERROR_IDS.AUTOMATION_RULE_HAS_NO_ACTIONS, "rule has no actions", {}),
    );
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
        new AppError(ERROR_IDS.AUTOMATION_NOT_FOUND, "automation rule not found", { id: input.id }),
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:integration -- rulesRepo`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/automations/rulesRepo.ts src/features/automations/rulesRepo.test.ts
git commit -m "feat(automations): add automation rule CRUD repo functions"
```

---

## Task 5: `automation.execute` job — action runners and worker registration

**Files:**
- Create: `src/features/automations/actionRunners.ts`
- Create: `src/features/automations/actionRunners.test.ts`
- Create: `src/features/automations/job.ts`
- Create: `src/features/automations/job.test.ts`
- Modify: `src/server/worker.ts`

**Interfaces:**
- Consumes: `AutomationRuleAction` from `@/db/schema/automations` (Task 1); `createActivity`
  from `@/features/activities/repo` (existing); `createNotification` from
  `@/features/notifications/produce` (existing); `sendGmail` from
  `@/features/email/sendSystem` (existing); `hydrateActor`/`toPermSetUser` from
  `@/server/hydrateActor` / `@/features/mcp/actorContext` (existing).
- Produces: `runAction(db, deal, action, signal): Promise<{ status:
  AutomationRunActionStatus; errorMessage: string | null; resultSummary: Record<string,
  unknown> | null }>` (one action's outcome, never throws for an operational failure — only
  programmer-error conditions surface as thrown `AppError`). `handleAutomationExecuteJob(db,
  job, signal): Promise<void>` and `registerAutomationExecuteWorker(boss): Promise<void>`,
  following the exact `reminders.ts` pattern. Task 3's `evaluateAutomations` already enqueues
  the jobs this consumes.
- **Deviation from the spec, noted deliberately**: the spec's Error handling section describes
  the `update_field` recursion guard as an `applyDealFields()` helper extracted from
  `updateDeal()`. This task implements the same guarantee (no chained automation re-trigger)
  more simply: `runUpdateField` never calls `updateDeal()` at all, writing the column plus a
  `recordChange` entry and a `publishBoardEvent` call directly in its own transaction. This
  avoids changing `updateDeal()`'s signature (a function with call sites across the deal
  actions, MCP tools, and tests) while still preserving deal-history and live-board-update
  parity with a normal user edit — the two things a naive raw `UPDATE` would have silently
  dropped. If a later phase needs `update_field` to support more than the `title` column,
  revisit whether this hand-rolled write still covers the needed validation, or whether it's
  grown enough to warrant the spec's original `applyDealFields()` extraction after all.

- [ ] **Step 1: Write the failing tests for `runAction`**

Create `src/features/automations/actionRunners.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { runAction } from "./actionRunners";

const sig = () => new AbortController().signal;

async function seedDealWithOwner(db: Db, ownerId: string): Promise<{ id: string; ownerId: string }> {
  const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
  const stage = stages[0];
  if (stage === undefined) throw new Error("no stage");
  const row = (
    await db.execute(sql`
      INSERT INTO deals (title, pipeline_id, stage_id, owner_id, visibility_level, status)
      VALUES ('Test Deal', ${pipeline.id}, ${stage.id}, ${ownerId}, 'all', 'open')
      RETURNING id, owner_id
    `)
  ).rows[0] as { id: string; owner_id: string } | undefined;
  if (row === undefined) throw new Error("no deal");
  return { id: row.id, ownerId: row.owner_id };
}

async function seedActivityType(db: Db): Promise<string> {
  const row = (
    await db.execute(sql`
      INSERT INTO activity_types (key, name, "order") VALUES ('call', 'Call', 0) RETURNING id
    `)
  ).rows[0] as { id: string } | undefined;
  if (row === undefined) throw new Error("no activity type");
  return row.id;
}

it("create_activity creates an activity assigned to the deal owner", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDealWithOwner(db, user.id);
    const typeId = await seedActivityType(db);

    const result = await runAction(
      db,
      deal,
      {
        id: "n/a",
        ruleId: "n/a",
        position: 0,
        actionType: "create_activity",
        actionConfig: { activityTypeId: typeId, subject: "Follow up" },
      } as never,
      sig(),
    );

    expect(result.status).toBe("success");
    expect(result.resultSummary).toHaveProperty("activityId");
  });
});

it("send_notification creates an in-app notification for the deal owner", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDealWithOwner(db, user.id);

    const result = await runAction(
      db,
      deal,
      {
        id: "n/a",
        ruleId: "n/a",
        position: 0,
        actionType: "send_notification",
        actionConfig: { messageTemplate: "Deal {{deal.title}} moved" },
      } as never,
      sig(),
    );

    expect(result.status).toBe("success");
    expect(result.resultSummary).toHaveProperty("notificationId");
  });
});

it("send_email fails with E_AUTOMATION_004 when the owner has no connected Gmail account", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDealWithOwner(db, user.id);

    const result = await runAction(
      db,
      deal,
      {
        id: "n/a",
        ruleId: "n/a",
        position: 0,
        actionType: "send_email",
        actionConfig: { subjectTemplate: "Hi", bodyTemplate: "Hello" },
      } as never,
      sig(),
    );

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("E_AUTOMATION_004");
  });
});

it("update_field updates the deal's title column", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDealWithOwner(db, user.id);

    const result = await runAction(
      db,
      deal,
      {
        id: "n/a",
        ruleId: "n/a",
        position: 0,
        actionType: "update_field",
        actionConfig: { fieldKey: "title", value: "Automated Title" },
      } as never,
      sig(),
    );

    expect(result.status).toBe("success");
    const row = (
      await db.execute(sql`SELECT title FROM deals WHERE id = ${deal.id}`)
    ).rows[0] as { title: string } | undefined;
    expect(row?.title).toBe("Automated Title");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:integration -- actionRunners`
Expected: FAIL — `./actionRunners` does not exist.

- [ ] **Step 3: Write `src/features/automations/template.ts`**

```ts
// Minimal {{deal.field}} placeholder substitution for automation message/email templates.
// Not a templating library dependency (YAGNI): three known placeholders don't need one.
export function renderTemplate(
  template: string,
  deal: { title: string; value: string | null; ownerName: string },
): string {
  return template
    .replaceAll("{{deal.title}}", deal.title)
    .replaceAll("{{deal.value}}", deal.value ?? "")
    .replaceAll("{{deal.owner}}", deal.ownerName);
}
```

- [ ] **Step 4: Write `src/features/automations/actionRunners.ts`**

```ts
import { eq } from "drizzle-orm";
import { BOARD_EVENT, dealChannel } from "@/constants/boardChannels";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AutomationRuleAction, AutomationRunActionStatus } from "@/db/schema/automations";
import { deals } from "@/db/schema/deals";
import { emailAccounts } from "@/db/schema/email";
import { persons } from "@/db/schema/persons";
import { users } from "@/db/schema/identity";
import { createActivity } from "@/features/activities/repo";
import { recordChange } from "@/features/collaboration/changeLog";
import { sendGmail } from "@/features/email/sendSystem";
import { toPermSetUser } from "@/features/mcp/actorContext";
import { createNotification } from "@/features/notifications/produce";
import { publishBoardEvent } from "@/server/realtime/events";
import { hydrateActor } from "@/server/hydrateActor";
import { renderTemplate } from "./template";

export interface ActionOutcome {
  status: AutomationRunActionStatus;
  errorMessage: string | null;
  resultSummary: Record<string, unknown> | null;
}

function ok(resultSummary: Record<string, unknown>): ActionOutcome {
  return { status: "success", errorMessage: null, resultSummary };
}

function failed(errorId: string, message: string): ActionOutcome {
  return { status: "error", errorMessage: `${errorId}: ${message}`, resultSummary: null };
}

type DealRow = typeof deals.$inferSelect;

async function loadDealTemplateContext(
  db: Db,
  deal: DealRow,
  signal: AbortSignal,
): Promise<{ title: string; value: string | null; ownerName: string }> {
  signal.throwIfAborted();
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, deal.ownerId));
  return { title: deal.title, value: deal.value, ownerName: owner?.name ?? "" };
}

async function runCreateActivity(
  db: Db,
  deal: DealRow,
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  const actor = await hydrateActor(db, deal.ownerId, signal);
  if (actor === null) {
    return failed(ERROR_IDS.AUTOMATION_NOT_FOUND, "deal owner is missing or inactive");
  }
  const result = await createActivity(
    db,
    toPermSetUser(actor),
    {
      typeId: config.activityTypeId as string,
      subject: config.subject as string,
      dealId: deal.id,
      assigneeId: deal.ownerId,
    } as never,
    signal,
  );
  if (!result.ok) return failed(result.error.id, result.error.message);
  return ok({ activityId: result.value.id });
}

async function runSendNotification(
  db: Db,
  deal: DealRow,
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  const ctx = await loadDealTemplateContext(db, deal, signal);
  const message = renderTemplate(String(config.messageTemplate ?? ""), ctx);
  const result = await createNotification(
    db,
    {
      recipientId: deal.ownerId,
      type: "automation",
      entityType: "deal",
      entityId: deal.id,
      actorId: null,
      payload: { message },
    },
    signal,
  );
  if (!result.ok) return failed(result.error.id, result.error.message);
  if ("suppressed" in result.value && result.value.suppressed) {
    return ok({ suppressed: true });
  }
  return ok({ notificationId: (result.value as { id: string }).id });
}

async function runSendEmail(
  db: Db,
  deal: DealRow,
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  const [account] = await db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.userId, deal.ownerId));
  if (account === undefined || account.status !== "connected") {
    return failed(
      ERROR_IDS.AUTOMATION_EMAIL_ACCOUNT_MISSING,
      "deal owner has no connected Gmail account",
    );
  }
  if (deal.personId === null) {
    return failed(
      ERROR_IDS.AUTOMATION_EMAIL_RECIPIENT_MISSING,
      "deal has no linked person to email",
    );
  }
  const [person] = await db
    .select({ primaryEmail: persons.primaryEmail })
    .from(persons)
    .where(eq(persons.id, deal.personId));
  if (person?.primaryEmail == null) {
    return failed(
      ERROR_IDS.AUTOMATION_EMAIL_RECIPIENT_MISSING,
      "linked person has no primary email",
    );
  }
  const ctx = await loadDealTemplateContext(db, deal, signal);
  const result = await sendGmail(
    account,
    {
      to: [person.primaryEmail],
      subject: renderTemplate(String(config.subjectTemplate ?? ""), ctx),
      bodyHtml: renderTemplate(String(config.bodyTemplate ?? ""), ctx),
    },
    signal,
  );
  if (!result.ok) return failed(result.error.id, result.error.message);
  return ok({ messageId: result.value.gmailMessageId });
}

async function runUpdateField(
  db: Db,
  deal: DealRow,
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  signal.throwIfAborted();
  const fieldKey = String(config.fieldKey ?? "");
  const value = config.value;
  // Phase 1 supports the same scalar deal columns deal_field_changed can trigger on. Custom
  // fields ("custom_field:<key>") are out of scope for this action until a real use case
  // justifies the extra jsonb-merge path (this rule is documented in the spec's Non-goals).
  const ALLOWED: Record<string, string> = { title: "title" };
  const column = ALLOWED[fieldKey];
  if (column === undefined) {
    return failed(ERROR_IDS.AUTOMATION_INPUT_INVALID, `unsupported update_field key: ${fieldKey}`);
  }
  // Deliberately does NOT call updateDeal(): that function's own trailing evaluateAutomations
  // calls would let this same rule (or another watching the same field) re-fire for every
  // execution, since nothing here changes what triggered this run. Recursion is prevented by
  // construction (this path never calls evaluateAutomations at all) rather than by a
  // skip-automations flag threaded through updateDeal()'s signature, keeping the change
  // confined to this file. recordChange + publishBoardEvent are still called directly (not via
  // updateDeal) so the field change gets the same deal-history entry and live board update a
  // normal user edit would get — silently writing the column with neither would leave the UI
  // showing a stale title until a manual refresh, which is the gap a Phase 1 implementer must
  // not reintroduce.
  const oldValue = (deal as unknown as Record<string, unknown>)[column];
  await db.transaction(async (tx) => {
    await tx.update(deals).set({ title: String(value) }).where(eq(deals.id, deal.id));
    await recordChange(
      tx,
      {
        entityType: "deal",
        entityId: deal.id,
        field: fieldKey,
        oldValue,
        newValue: value,
        actorId: deal.ownerId,
      },
      signal,
    );
    await publishBoardEvent(
      tx,
      {
        channel: dealChannel(deal.id),
        type: BOARD_EVENT.dealUpdated,
        actorId: deal.ownerId,
        data: { dealId: deal.id },
      },
      signal,
    );
  });
  return ok({ fieldKey, value });
}

export async function runAction(
  db: Db,
  deal: DealRow,
  action: AutomationRuleAction,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  signal.throwIfAborted();
  const config = action.actionConfig as Record<string, unknown>;
  switch (action.actionType) {
    case "create_activity":
      return runCreateActivity(db, deal, config, signal);
    case "send_notification":
      return runSendNotification(db, deal, config, signal);
    case "send_email":
      return runSendEmail(db, deal, config, signal);
    case "update_field":
      return runUpdateField(db, deal, config, signal);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:integration -- actionRunners`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Write the failing test for the job handler**

Create `src/features/automations/job.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { createAutomationRule } from "./rulesRepo";
import { handleAutomationExecuteJob } from "./job";

const sig = () => new AbortController().signal;

async function seedDeal(db: Db, ownerId: string): Promise<string> {
  const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
  const stage = stages[0];
  if (stage === undefined) throw new Error("no stage");
  const row = (
    await db.execute(sql`
      INSERT INTO deals (title, pipeline_id, stage_id, owner_id, visibility_level, status)
      VALUES ('Test Deal', ${pipeline.id}, ${stage.id}, ${ownerId}, 'all', 'open')
      RETURNING id
    `)
  ).rows[0] as { id: string } | undefined;
  if (row === undefined) throw new Error("no deal");
  return row.id;
}

it("writes a success run when every action succeeds", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id);
    const rule = await createAutomationRule(
      db,
      user.id,
      {
        name: "Notify Rule",
        description: null,
        pipelineId: null,
        trigger: "deal_created",
        triggerConfig: {},
        actions: [{ actionType: "send_notification", config: { messageTemplate: "hi" } }],
        isActive: true,
      },
      sig(),
    );
    if (!rule.ok) throw new Error("setup failed");

    await handleAutomationExecuteJob(
      db,
      { data: { ruleId: rule.value.id, dealId, trigger: "deal_created" } },
      sig(),
    );

    const run = (
      await db.execute(sql`SELECT status, rule_name FROM automation_runs WHERE deal_id = ${dealId}`)
    ).rows[0] as { status: string; rule_name: string } | undefined;
    expect(run?.status).toBe("success");
    expect(run?.rule_name).toBe("Notify Rule");

    const actions = (
      await db.execute(
        sql`SELECT status FROM automation_run_actions ara
            JOIN automation_runs ar ON ar.id = ara.run_id
            WHERE ar.deal_id = ${dealId}`,
      )
    ).rows as { status: string }[];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.status).toBe("success");
  });
});

it("writes a partial run when one action fails and later actions still run", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id);
    const rule = await createAutomationRule(
      db,
      user.id,
      {
        name: "Mixed Rule",
        description: null,
        pipelineId: null,
        trigger: "deal_created",
        triggerConfig: {},
        actions: [
          { actionType: "send_email", config: { subjectTemplate: "Hi", bodyTemplate: "Hi" } },
          { actionType: "send_notification", config: { messageTemplate: "hi" } },
        ],
        isActive: true,
      },
      sig(),
    );
    if (!rule.ok) throw new Error("setup failed");

    await handleAutomationExecuteJob(
      db,
      { data: { ruleId: rule.value.id, dealId, trigger: "deal_created" } },
      sig(),
    );

    const run = (
      await db.execute(sql`SELECT status FROM automation_runs WHERE deal_id = ${dealId}`)
    ).rows[0] as { status: string } | undefined;
    expect(run?.status).toBe("partial");

    const actions = (
      await db.execute(
        sql`SELECT status FROM automation_run_actions ara
            JOIN automation_runs ar ON ar.id = ara.run_id
            WHERE ar.deal_id = ${dealId} ORDER BY ara.position`,
      )
    ).rows as { status: string }[];
    expect(actions.map((a) => a.status)).toEqual(["error", "success"]);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm test:integration -- job`
Expected: FAIL — `./job` does not exist.

- [ ] **Step 8: Write `src/features/automations/job.ts`**

```ts
import type { Job, PgBoss } from "pg-boss";
import { eq } from "drizzle-orm";
import { PGBOSS_QUEUE_AUTOMATION_EXECUTE } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { db as prodDb } from "@/db/client";
import type { AutomationTrigger } from "@/db/schema/automations";
import { automationRuleActions, automationRunActions, automationRuns } from "@/db/schema/automations";
import { deals } from "@/db/schema/deals";
import { runAction } from "./actionRunners";
import { getAutomationRule } from "./rulesRepo";

interface AutomationExecuteJob {
  data: { ruleId: string; dealId: string; trigger: AutomationTrigger };
}

// Re-reads the rule, its actions, and the deal at fire time (never trusts data captured at
// enqueue time — the deal may have moved further, or the rule may have been edited, between
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
```

Note: `automationRuleActions` is imported but unused directly in this file (actions come via
`getAutomationRule`) — remove that import if your editor flags it; it's listed above only to
match the interface block's stated consumption. Verify with `pnpm lint`.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm test:integration -- job`
Expected: PASS, both tests.

- [ ] **Step 10: Register the worker**

In `src/server/worker.ts`, add the import:

```ts
import { registerAutomationExecuteWorker } from "@/features/automations/job";
```

Add `await registerAutomationExecuteWorker(boss);` alongside the existing
`registerReminderWorker`/`registerImportWorkers` calls.

- [ ] **Step 11: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. Remove the unused `automationRuleActions` import from `job.ts` if lint flags
it (per the note in Step 8).

- [ ] **Step 12: Commit**

```bash
git add src/features/automations/actionRunners.ts src/features/automations/actionRunners.test.ts src/features/automations/template.ts src/features/automations/job.ts src/features/automations/job.test.ts src/server/worker.ts
git commit -m "feat(automations): add action runners, automation.execute job, worker registration"
```

---

## Task 6: Server actions and tRPC router

**Files:**
- Create: `src/features/automations/actions.ts`
- Create: `src/features/automations/router.ts`
- Modify: `src/server/trpc/root.ts`

**Interfaces:**
- Consumes: everything from Task 2 (`schemas.ts`) and Task 4 (`rulesRepo.ts`).
- Produces: `createAutomationRuleAction`, `updateAutomationRuleAction`,
  `setAutomationRuleActiveAction`, `deleteAutomationRuleAction` server actions (same
  `ActionResult<T>` shape every other feature uses); `automationsRouter` with
  `list`/`get`/`listRunsForRule` query procedures. Task 7/8's client components call the
  actions; Task 7/8's server components call the router via `createCaller` or the client
  components call it via `trpc.automations.*`.

- [ ] **Step 1: Write `src/features/automations/actions.ts`**

```ts
"use server";

import type { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import {
  createAutomationRule,
  deleteAutomationRule,
  setAutomationRuleActive,
  updateAutomationRule,
} from "./rulesRepo";
import {
  createAutomationRuleInputSchema,
  deleteAutomationRuleInputSchema,
  setAutomationRuleActiveInputSchema,
  updateAutomationRuleInputSchema,
} from "./schemas";

type ActionResult<T> = { ok: true; value: T } | { ok: false; error: { id: string } };

async function gateAutomationManage(
  csrfToken: string | null,
): Promise<{ ok: true; actorId: string } | { ok: false; error: { id: string } }> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  if (!can(actor, "automation.manage")) return { ok: false, error: { id: ERROR_IDS.PERM_DENIED } };
  return { ok: true, actorId: actor.id };
}

export async function createAutomationRuleAction(
  input: z.input<typeof createAutomationRuleInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateAutomationManage(csrfToken);
  if (!g.ok) return g;
  const parsed = createAutomationRuleInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.AUTOMATION_INPUT_INVALID } };
  const result = await createAutomationRule(db, g.actorId, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function updateAutomationRuleAction(
  input: z.input<typeof updateAutomationRuleInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateAutomationManage(csrfToken);
  if (!g.ok) return g;
  const parsed = updateAutomationRuleInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.AUTOMATION_INPUT_INVALID } };
  const result = await updateAutomationRule(db, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function setAutomationRuleActiveAction(
  input: z.input<typeof setAutomationRuleActiveInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateAutomationManage(csrfToken);
  if (!g.ok) return g;
  const parsed = setAutomationRuleActiveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.AUTOMATION_INPUT_INVALID } };
  const result = await setAutomationRuleActive(db, parsed.data.id, parsed.data.isActive, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function deleteAutomationRuleAction(
  input: z.input<typeof deleteAutomationRuleInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateAutomationManage(csrfToken);
  if (!g.ok) return g;
  const parsed = deleteAutomationRuleInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.AUTOMATION_INPUT_INVALID } };
  const result = await deleteAutomationRule(db, parsed.data.id, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}
```

- [ ] **Step 2: Write `src/features/automations/router.ts`**

```ts
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { automationRuns } from "@/db/schema/automations";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { getAutomationRule, listAutomationRules } from "./rulesRepo";

export const automationsRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    listAutomationRules(ctx.db, AbortSignal.timeout(10_000)),
  ),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await getAutomationRule(ctx.db, input.id, AbortSignal.timeout(10_000));
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.error.id });
      return result.value;
    }),

  listRunsForRule: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      ctx.db
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.ruleId, input.ruleId))
        .orderBy(desc(automationRuns.startedAt))
        .limit(100),
    ),
});
```

- [ ] **Step 3: Mount the router**

In `src/server/trpc/root.ts`, add the import (alphabetically):

```ts
import { automationsRouter } from "@/features/automations/router";
```

Add to the `appRouter` object (alphabetically among the existing entries):

```ts
  automations: automationsRouter,
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/automations/actions.ts src/features/automations/router.ts src/server/trpc/root.ts
git commit -m "feat(automations): add server actions and tRPC router"
```

---

## Task 7: Settings UI — rules list page

**Files:**
- Create: `src/app/(app)/settings/automations/page.tsx`
- Create: `src/app/(app)/settings/automations/AutomationsClient.tsx`
- Create: `src/app/(app)/settings/automations/AutomationsTable.tsx`
- Modify: `src/app/(app)/settings/SettingsNav.tsx`
- Modify: `src/constants/settingsStrings.ts`

**Interfaces:**
- Consumes: `listAutomationRules` from `@/features/automations/rulesRepo` (Task 4);
  `setAutomationRuleActiveAction`, `deleteAutomationRuleAction` from
  `@/features/automations/actions` (Task 6).
- Produces: the `/settings/automations` route. Task 8's `AutomationWizard` is rendered from
  `AutomationsClient.tsx`'s "+ Automation" button, added in that task (this task's
  `AutomationsClient` renders the button as a link/state toggle that Task 8 wires up — see
  Task 8 Step 1 for the exact integration point).

- [ ] **Step 1: Add settings strings**

In `src/constants/settingsStrings.ts`, add (following the existing key style, e.g. next to
`products`/`productsDescription`):

```ts
  automations: "Automations",
  automationsDescription: "Automatically create activities, send notifications and emails, or update fields when a deal changes.",
```

- [ ] **Step 2: Write `page.tsx`**

```tsx
import type { ReactNode } from "react";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import { can } from "@/features/permissions/can";
import { listAutomationRules } from "@/features/automations/rulesRepo";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { AutomationsClient } from "./AutomationsClient";

export const metadata = { title: SETTINGS_STRINGS.automations };

export default async function AutomationsSettingsPage(): Promise<ReactNode> {
  const { actor, db } = await createContext();
  if (actor === null || !can(actor, "automation.manage")) {
    return <p className="text-sm text-red-600">{SETTINGS_STRINGS.requiresAdmin}</p>;
  }
  const rules = await listAutomationRules(db, AbortSignal.timeout(5000));

  return (
    <SettingsPage>
      <SettingsHeading
        title={SETTINGS_STRINGS.automations}
        description={SETTINGS_STRINGS.automationsDescription}
      />
      <AutomationsClient rules={rules} />
    </SettingsPage>
  );
}
```

- [ ] **Step 3: Write `AutomationsTable.tsx`**

```tsx
"use client";

import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import type { AutomationRule } from "@/db/schema/automations";

const TRIGGER_LABEL: Record<string, string> = {
  deal_created: "Deal created",
  deal_stage_changed: "Deal stage changed",
  deal_status_changed: "Deal won or lost",
  deal_field_changed: "Deal field changed",
};

export function AutomationsTable({
  rules,
  onToggle,
  onEdit,
  onDelete,
}: {
  rules: AutomationRule[];
  onToggle: (id: string, isActive: boolean) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}): React.ReactNode {
  if (rules.length === 0) {
    return <p className="text-sm text-muted-foreground">No automations yet.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="py-2">Name</th>
          <th className="py-2">Trigger</th>
          <th className="py-2">Active</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody>
        {rules.map((rule) => (
          <tr key={rule.id} className="border-t">
            <td className="py-2 font-medium">{rule.name}</td>
            <td className="py-2 text-muted-foreground">{TRIGGER_LABEL[rule.trigger]}</td>
            <td className="py-2">
              <Switch
                checked={rule.isActive}
                onCheckedChange={(v) => onToggle(rule.id, v)}
                label={`${rule.name} active`}
              />
            </td>
            <td className="py-2 text-right">
              <Button variant="ghost" onClick={() => onEdit(rule.id)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => onDelete(rule.id)}>
                Delete
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Write `AutomationsClient.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import type { AutomationRule } from "@/db/schema/automations";
import { readCsrfToken } from "@/utils/csrfCookie";
import { deleteAutomationRuleAction, setAutomationRuleActiveAction } from "@/features/automations/actions";
import { AutomationsTable } from "./AutomationsTable";

export function AutomationsClient({ rules: initialRules }: { rules: AutomationRule[] }): React.ReactNode {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh(): void {
    router.refresh();
  }

  async function toggle(id: string, isActive: boolean): Promise<void> {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, isActive } : r)));
    const r = await setAutomationRuleActiveAction({ id, isActive }, readCsrfToken());
    if (!r.ok) {
      setRules((prev) => prev.map((rr) => (rr.id === id ? { ...rr, isActive: !isActive } : rr)));
      setError("Could not update the automation.");
    }
  }

  async function confirmDelete(): Promise<void> {
    const id = pendingDelete;
    if (id === null) return;
    setPendingDelete(null);
    const r = await deleteAutomationRuleAction({ id }, readCsrfToken());
    if (r.ok) {
      setRules((prev) => prev.filter((rr) => rr.id !== id));
      refresh();
      return;
    }
    setError("Could not delete the automation.");
  }

  return (
    <div className="space-y-3">
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AutomationsTable
        rules={rules}
        onToggle={(id, v) => void toggle(id, v)}
        onEdit={(id) => router.push(`/settings/automations/${id}`)}
        onDelete={(id) => setPendingDelete(id)}
      />
      <Button onClick={() => router.push("/settings/automations/new")}>+ Automation</Button>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete automation"
        description="This permanently deletes the automation rule. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
```

(`refresh()` is called from `confirmDelete` above, on top of the optimistic `setRules` update,
so the server-rendered list (`page.tsx`'s `listAutomationRules` call) stays in sync too — not
dead code, and not something Task 8 needs to reach into: Task 8's wizard is a separate routed
page that calls `router.refresh()` directly itself after a save, matching the same pattern
independently rather than sharing this component's local function.)

- [ ] **Step 5: Add the settings nav entry**

In `src/app/(app)/settings/SettingsNav.tsx`, add `Zap` (or a similar lucide icon already
unused in this file — check the existing import list before picking) to the icon imports, and
add to the `items` array in the `COMPANY` section (near `products`):

```ts
    { href: "/settings/automations", label: SETTINGS_STRINGS.automations, icon: Zap },
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (`/settings/automations/new` and `/settings/automations/[id]` routes don't
exist yet — that's fine, Next.js only errors on unresolved routes at request time, not
typecheck time, and Task 8 adds them next.)

- [ ] **Step 7: Manual verification note**

This task has no automated test of its own (a server component + two client components
rendering already-tested repo data, matching the products settings page's own lack of a
dedicated page-level test). Defer visual verification to Task 9's final manual check, once
Task 8 makes the page fully functional (right now "+ Automation" links to a route that
doesn't exist yet).

- [ ] **Step 8: Commit**

```bash
git add src/app/\(app\)/settings/automations/page.tsx src/app/\(app\)/settings/automations/AutomationsClient.tsx src/app/\(app\)/settings/automations/AutomationsTable.tsx src/app/\(app\)/settings/SettingsNav.tsx src/constants/settingsStrings.ts
git commit -m "feat(automations): add settings list page for automation rules"
```

---

## Task 8: Settings UI — creation/edit wizard

**Files:**
- Create: `src/app/(app)/settings/automations/new/page.tsx`
- Create: `src/app/(app)/settings/automations/[id]/page.tsx`
- Create: `src/app/(app)/settings/automations/AutomationWizard.tsx`
- Create: `src/app/(app)/settings/automations/AutomationWizard.test.tsx`

**Interfaces:**
- Consumes: `createAutomationRuleAction`, `updateAutomationRuleAction` from
  `@/features/automations/actions` (Task 6); `AUTOMATION_TRIGGERS`, `AUTOMATION_ACTION_TYPES`
  from `@/db/schema/automations` (Task 1); `trpc.automations.get`/`trpc.pipelines.*` (existing
  pipeline list procedure — check `src/features/pipelines/pipelineRouter.ts`'s exact
  procedure name and use it, matching whatever the deal-creation pipeline picker already
  calls) for populating the pipeline/stage/activity-type pickers.
- Produces: the wizard component, reused by both the "new" and "[id]" edit routes (edit mode
  passes an `initialRule` prop, create mode passes `null`).

- [ ] **Step 1: Write the failing test**

Create `src/app/(app)/settings/automations/AutomationWizard.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

const { createAutomationRuleAction } = vi.hoisted(() => ({
  createAutomationRuleAction: vi.fn(() => Promise.resolve({ ok: true, value: { id: "r1" } })),
}));
vi.mock("@/features/automations/actions", () => ({
  createAutomationRuleAction,
  updateAutomationRuleAction: vi.fn(),
  setAutomationRuleActiveAction: vi.fn(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    pipelines: { list: { useQuery: () => ({ data: [{ id: "p1", name: "Sales" }] }) } },
    activityTypes: { list: { useQuery: () => ({ data: [{ id: "t1", name: "Call" }] }) } },
  },
}));

import { AutomationWizard } from "./AutomationWizard";

it("submits a rule with the selected trigger, one action, and a name", async () => {
  render(<AutomationWizard initialRule={null} />);

  screen.getByLabelText("Automation name").focus();
  await import("@testing-library/user-event").then(({ default: userEvent }) =>
    userEvent.setup().type(screen.getByLabelText("Automation name"), "My Rule"),
  );

  screen.getByRole("button", { name: "Save" }).click();

  await waitFor(() => expect(createAutomationRuleAction).toHaveBeenCalled());
  const [input] = createAutomationRuleAction.mock.calls[0] as [Record<string, unknown>];
  expect(input.name).toBe("My Rule");
  expect(input.trigger).toBe("deal_created");
  expect(Array.isArray(input.actions)).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- AutomationWizard`
Expected: FAIL — `./AutomationWizard` does not exist.

- [ ] **Step 3: Write `AutomationWizard.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGERS,
  type AutomationActionType,
  type AutomationRule,
  type AutomationRuleAction,
  type AutomationTrigger,
} from "@/db/schema/automations";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  createAutomationRuleAction,
  setAutomationRuleActiveAction,
  updateAutomationRuleAction,
} from "@/features/automations/actions";

const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  deal_created: "Deal created",
  deal_stage_changed: "Deal stage changed",
  deal_status_changed: "Deal won or lost",
  deal_field_changed: "Deal field changed",
};

const ACTION_LABEL: Record<AutomationActionType, string> = {
  create_activity: "Create activity",
  send_notification: "Send notification",
  send_email: "Send email",
  update_field: "Update field",
};

interface DraftAction {
  actionType: AutomationActionType;
  config: Record<string, unknown>;
}

export function AutomationWizard({
  initialRule,
}: {
  initialRule: { rule: AutomationRule; actions: AutomationRuleAction[] } | null;
}): React.ReactNode {
  const router = useRouter();
  const pipelinesQuery = trpc.pipelines.list.useQuery();
  const activityTypesQuery = trpc.activityTypes.list.useQuery();
  const pipelines = pipelinesQuery.data ?? [];
  const activityTypes = activityTypesQuery.data ?? [];

  const [name, setName] = useState(initialRule?.rule.name ?? "");
  const [description, setDescription] = useState(initialRule?.rule.description ?? "");
  const [pipelineId, setPipelineId] = useState(initialRule?.rule.pipelineId ?? "");
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    initialRule?.rule.trigger ?? "deal_created",
  );
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(
    (initialRule?.rule.triggerConfig as Record<string, unknown>) ?? {},
  );
  const [isActive, setIsActive] = useState(initialRule?.rule.isActive ?? true);
  const [actions, setActions] = useState<DraftAction[]>(
    initialRule?.actions.map((a) => ({
      actionType: a.actionType,
      config: a.actionConfig as Record<string, unknown>,
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function addAction(actionType: AutomationActionType): void {
    setActions((prev) => [...prev, { actionType, config: {} }]);
  }

  function updateActionConfig(index: number, config: Record<string, unknown>): void {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, config } : a)));
  }

  function removeAction(index: number): void {
    setActions((prev) => prev.filter((_, i) => i !== index));
  }

  async function save(): Promise<void> {
    setError(null);
    setPending(true);
    const payload = {
      name,
      description: description.trim() === "" ? null : description,
      pipelineId: pipelineId === "" ? null : pipelineId,
      trigger,
      triggerConfig,
      actions: actions.map((a) => ({ actionType: a.actionType, config: a.config })),
    };
    const r =
      initialRule === null
        ? await createAutomationRuleAction({ ...payload, isActive }, readCsrfToken())
        : await updateAutomationRuleAction({ ...payload, id: initialRule.rule.id }, readCsrfToken());
    if (!r.ok) {
      setPending(false);
      setError(
        r.error.id === "E_AUTOMATION_003"
          ? "Add at least one action before saving."
          : "Could not save the automation.",
      );
      return;
    }
    // updateAutomationRuleInputSchema has no isActive field (Task 2) — the edit wizard's
    // Active switch is otherwise a dead control that silently discards its value on save, since
    // toggling active status is normally Task 7's table switch, calling
    // setAutomationRuleActiveAction directly. Only fire this second call when editing AND the
    // switch actually changed, so a create (which already sent isActive above) and an
    // unchanged edit don't take a redundant round trip.
    if (initialRule !== null && isActive !== initialRule.rule.isActive) {
      const activeResult = await setAutomationRuleActiveAction(
        { id: initialRule.rule.id, isActive },
        readCsrfToken(),
      );
      setPending(false);
      if (!activeResult.ok) {
        setError("Automation saved, but the active toggle could not be updated.");
        return;
      }
    } else {
      setPending(false);
    }
    router.push("/settings/automations");
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Trigger</h3>
        <Select
          ariaLabel="Trigger"
          value={trigger}
          onChange={(v) => {
            setTrigger(v as AutomationTrigger);
            setTriggerConfig({});
          }}
          options={AUTOMATION_TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABEL[t] }))}
        />
        {trigger === "deal_status_changed" && (
          <Select
            ariaLabel="Status"
            value={(triggerConfig.toStatus as string) ?? ""}
            onChange={(v) => setTriggerConfig({ toStatus: v })}
            options={[
              { value: "won", label: "Won" },
              { value: "lost", label: "Lost" },
            ]}
          />
        )}
        {trigger === "deal_field_changed" && (
          <Input
            aria-label="Field key"
            placeholder="e.g. title"
            value={(triggerConfig.fieldKey as string) ?? ""}
            onChange={(e) => setTriggerConfig({ fieldKey: e.target.value })}
          />
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Pipeline</h3>
        <Select
          ariaLabel="Pipeline"
          value={pipelineId}
          onChange={setPipelineId}
          options={[
            { value: "", label: "All pipelines" },
            ...pipelines.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Actions</h3>
        {actions.map((action, i) => (
          <div key={`${action.actionType}-${i}`} className="rounded border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{ACTION_LABEL[action.actionType]}</span>
              <Button variant="ghost" onClick={() => removeAction(i)}>
                Remove
              </Button>
            </div>
            {action.actionType === "create_activity" && (
              <>
                <Select
                  ariaLabel="Activity type"
                  value={(action.config.activityTypeId as string) ?? ""}
                  onChange={(v) => updateActionConfig(i, { ...action.config, activityTypeId: v })}
                  options={activityTypes.map((t) => ({ value: t.id, label: t.name }))}
                />
                <Input
                  aria-label="Subject"
                  placeholder="Subject"
                  value={(action.config.subject as string) ?? ""}
                  onChange={(e) => updateActionConfig(i, { ...action.config, subject: e.target.value })}
                />
              </>
            )}
            {action.actionType === "send_notification" && (
              <Textarea
                aria-label="Notification message"
                placeholder="Message (use {{deal.title}}, {{deal.value}}, {{deal.owner}})"
                value={(action.config.messageTemplate as string) ?? ""}
                onChange={(e) =>
                  updateActionConfig(i, { ...action.config, messageTemplate: e.target.value })
                }
              />
            )}
            {action.actionType === "send_email" && (
              <>
                <Input
                  aria-label="Email subject"
                  placeholder="Subject"
                  value={(action.config.subjectTemplate as string) ?? ""}
                  onChange={(e) =>
                    updateActionConfig(i, { ...action.config, subjectTemplate: e.target.value })
                  }
                />
                <Textarea
                  aria-label="Email body"
                  placeholder="Body"
                  value={(action.config.bodyTemplate as string) ?? ""}
                  onChange={(e) =>
                    updateActionConfig(i, { ...action.config, bodyTemplate: e.target.value })
                  }
                />
              </>
            )}
            {action.actionType === "update_field" && (
              <>
                <Input
                  aria-label="Field key"
                  placeholder="title"
                  value={(action.config.fieldKey as string) ?? ""}
                  onChange={(e) => updateActionConfig(i, { ...action.config, fieldKey: e.target.value })}
                />
                <Input
                  aria-label="New value"
                  placeholder="Value"
                  value={(action.config.value as string) ?? ""}
                  onChange={(e) => updateActionConfig(i, { ...action.config, value: e.target.value })}
                />
              </>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {AUTOMATION_ACTION_TYPES.map((t) => (
            <Button key={t} variant="ghost" onClick={() => addAction(t)}>
              + {ACTION_LABEL[t]}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Name</h3>
        <Input
          aria-label="Automation name"
          placeholder="Name"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          aria-label="Description"
          placeholder="Description (optional)"
          maxLength={200}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Switch checked={isActive} onCheckedChange={setIsActive} label="Active" />
      </div>

      <Button onClick={() => void save()} disabled={pending || name.trim() === ""}>
        Save
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- AutomationWizard`
Expected: PASS.

- [ ] **Step 5: Write the "new" route**

Create `src/app/(app)/settings/automations/new/page.tsx`:

```tsx
import type { ReactNode } from "react";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../../SettingsHeading";
import { SettingsPage } from "../../SettingsSurface";
import { AutomationWizard } from "../AutomationWizard";

export default async function NewAutomationPage(): Promise<ReactNode> {
  const { actor } = await createContext();
  if (actor === null || !can(actor, "automation.manage")) {
    return <p className="text-sm text-red-600">Admin access required.</p>;
  }
  return (
    <SettingsPage>
      <SettingsHeading title="New automation" description="" />
      <AutomationWizard initialRule={null} />
    </SettingsPage>
  );
}
```

- [ ] **Step 6: Write the "[id]" edit route**

Create `src/app/(app)/settings/automations/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { can } from "@/features/permissions/can";
import { getAutomationRule } from "@/features/automations/rulesRepo";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../../SettingsHeading";
import { SettingsPage } from "../../SettingsSurface";
import { AutomationWizard } from "../AutomationWizard";

export default async function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { actor, db } = await createContext();
  if (actor === null || !can(actor, "automation.manage")) {
    return <p className="text-sm text-red-600">Admin access required.</p>;
  }
  const { id } = await params;
  const result = await getAutomationRule(db, id, AbortSignal.timeout(5000));
  if (!result.ok) notFound();

  return (
    <SettingsPage>
      <SettingsHeading title="Edit automation" description="" />
      <AutomationWizard initialRule={result.value} />
    </SettingsPage>
  );
}
```

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. If `trpc.pipelines.list` or `trpc.activityTypes.list` don't exist under those
exact router/procedure names, grep `src/server/trpc/root.ts` and the relevant feature routers
for the actual names (this plan's survey did not confirm the exact tRPC procedure names for
listing pipelines/activity types — only the underlying repo functions
`listVisiblePipelines`/`listTypes`) and adjust `AutomationWizard.tsx`'s two `trpc.*.useQuery()`
calls to match. If neither is exposed via tRPC yet, add a minimal query procedure to the
existing `pipelineRouter`/an activity-types router following the same one-line pattern as
`router.ts`'s `list` procedure in Task 6, rather than introducing a new router file for a
single query.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/settings/automations/new/page.tsx" "src/app/(app)/settings/automations/[id]/page.tsx" src/app/\(app\)/settings/automations/AutomationWizard.tsx src/app/\(app\)/settings/automations/AutomationWizard.test.tsx
git commit -m "feat(automations): add create/edit wizard and its two routes"
```

---

## Task 9: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test:unit && pnpm test:integration`
Expected: PASS, no regressions outside this plan's known pre-existing baseline failures (check
the repo's current baseline the same way prior plans in this codebase have: run the suite once
on `main` before this branch's changes if you're unsure which failures are pre-existing).

- [ ] **Step 2: Typecheck and lint the whole repo**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Apply the migration to the local dev database**

Run: `pnpm db:migrate` (override `DATABASE_URL` to the host-reachable Postgres port if running
outside the Docker network, matching the pattern used for prior features in this repo).
Expected: the four new tables and four new enums appear; confirm with `\d automation_rules`
etc. against the actual database.

- [ ] **Step 4: Manual smoke test**

Start the dev server (or rebuild/restart the Docker app container so it picks up this
branch's code), then, against a real deal with a linked person/org and a connected Gmail
account for at least one test user:

1. Go to Settings → Automations, create a rule: trigger "Deal stage changed" targeting a
   specific stage, one pipeline, action "Create activity" with a real activity type and
   subject. Save, confirm it appears in the list, toggle it active.
2. Move a deal into that stage on the pipeline board. Confirm (after the worker processes the
   job — check `automation_runs` directly if the UI has no auto-refresh) that a new activity
   was created, assigned to the deal's owner, and that `automation_runs`/
   `automation_run_actions` show a `success` row.
3. Edit the rule to also add a "Send notification" action; save; move a different deal into
   the same stage; confirm both actions ran (check the in-app notification bell and the
   activity list).
4. Create a rule with action "Send email" for a deal owner who has NO connected Gmail account;
   trigger it; confirm the run shows `error`/`partial` with an `E_AUTOMATION_004` message, and
   that this doesn't crash the worker process (check its logs for an unhandled rejection —
   there should be none).
5. Delete a rule; confirm its prior `automation_runs` rows are still visible (if a runs-history
   view is wired to the list page) and still show the original rule name, not "unknown".

Document what you tested and its outcome; if you cannot run a full browser session, substitute
the strongest available check the way prior plans in this repo have (direct HTTP requests with
a minted session cookie, or a script driving the repo functions directly against the real dev
database) and say so explicitly rather than claiming an unverified success.
