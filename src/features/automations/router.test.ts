// @vitest-environment node
// Integration tests for the automations tRPC router against real Postgres (no DB mocks).
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { HydratedActor } from "@/server/hydrateActor";
import { createCaller } from "@/server/trpc/root";
import { createAutomationRule } from "./rulesRepo";

const sig = () => new AbortController().signal;

function makeActor(id: string, flags: PermissionFlagKey[] = ["automation.manage"]): HydratedActor {
  return {
    id,
    type: "regular",
    isActive: true,
    name: "Test User",
    email: "test@example.com",
    avatarUrl: null,
    flags: new Set<PermissionFlagKey>(flags),
    groupIds: new Set<string>(),
  };
}

function makeCaller(
  db: Db,
  userId: string,
  flags: PermissionFlagKey[] = ["automation.manage"],
): ReturnType<typeof createCaller> {
  return createCaller({
    db,
    session: { userId, sessionId: "test-session" },
    actor: makeActor(userId, flags),
  });
}

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

describe("automation.manage gate", () => {
  it("rejects list for an actor without automation.manage", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      await expect(makeCaller(db, user.id, []).automations.list()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  it("rejects get for an actor without automation.manage", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const created = await createAutomationRule(
        db,
        user.id,
        {
          name: "Gated rule",
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

      await expect(
        makeCaller(db, user.id, []).automations.get({ id: created.value.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  it("rejects listRunsForRule for an actor without automation.manage", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      await expect(
        makeCaller(db, user.id, []).automations.listRunsForRule({
          ruleId: "00000000-0000-0000-0000-000000000000",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  it("rejects listActionsForRun for an actor without automation.manage", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      await expect(
        makeCaller(db, user.id, []).automations.listActionsForRun({
          runId: "00000000-0000-0000-0000-000000000000",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});

describe("automations.list", () => {
  it("returns created rules newest first", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const first = await createAutomationRule(
        db,
        user.id,
        {
          name: "First",
          description: null,
          pipelineId: null,
          trigger: "deal_created",
          triggerConfig: {},
          actions: [{ actionType: "send_notification", config: {} }],
          isActive: true,
        },
        sig(),
      );
      if (!first.ok) throw new Error("setup failed");

      const rows = await makeCaller(db, user.id).automations.list();
      expect(rows.some((r) => r.id === first.value.id)).toBe(true);
    });
  });
});

describe("automations.get", () => {
  it("returns the rule with its actions", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const created = await createAutomationRule(
        db,
        user.id,
        {
          name: "Rule with actions",
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

      const result = await makeCaller(db, user.id).automations.get({ id: created.value.id });
      expect(result.rule.name).toBe("Rule with actions");
      expect(result.actions).toHaveLength(1);
    });
  });

  it("throws NOT_FOUND for a missing rule id", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      await expect(
        makeCaller(db, user.id).automations.get({
          id: "00000000-0000-0000-0000-000000000000",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});

describe("automations.listRunsForRule", () => {
  it("returns runs for the rule, most recent first", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const dealId = await seedDeal(db, user.id);
      const created = await createAutomationRule(
        db,
        user.id,
        {
          name: "Runs Rule",
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

      await db.execute(sql`
        INSERT INTO automation_runs (rule_id, rule_name, deal_id, trigger, status)
        VALUES (${created.value.id}, 'Runs Rule', ${dealId}, 'deal_created', 'success')
      `);

      const runs = await makeCaller(db, user.id).automations.listRunsForRule({
        ruleId: created.value.id,
      });
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe("success");
    });
  });
});

describe("automations.listActionsForRun", () => {
  it("returns actions for the run, ordered by position", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const dealId = await seedDeal(db, user.id);
      const created = await createAutomationRule(
        db,
        user.id,
        {
          name: "Actions Rule",
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

      const runRow = (
        await db.execute(sql`
          INSERT INTO automation_runs (rule_id, rule_name, deal_id, trigger, status)
          VALUES (${created.value.id}, 'Actions Rule', ${dealId}, 'deal_created', 'success')
          RETURNING id
        `)
      ).rows[0] as { id: string } | undefined;
      if (runRow === undefined) throw new Error("no run row");

      await db.execute(sql`
        INSERT INTO automation_run_actions (run_id, position, action_type, status)
        VALUES (${runRow.id}, 0, 'send_notification', 'success')
      `);

      const actions = await makeCaller(db, user.id).automations.listActionsForRun({
        runId: runRow.id,
      });
      expect(actions).toHaveLength(1);
      expect(actions[0]?.actionType).toBe("send_notification");
    });
  });

  it("returns [] for a run with no actions", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const actions = await makeCaller(db, user.id).automations.listActionsForRun({
        runId: "00000000-0000-0000-0000-000000000000",
      });
      expect(actions).toEqual([]);
    });
  });
});
