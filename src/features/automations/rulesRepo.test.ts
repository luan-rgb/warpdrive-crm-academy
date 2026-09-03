import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
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

// automation_runs.ruleName is a text snapshot column, separate from the FK ruleId (ON DELETE SET
// NULL), specifically so a run's history stays readable after its rule is deleted (design spec
// Testing section). Seeds the run row directly via SQL since there is no repo writer for it
// (job.ts's handleAutomationExecuteJob owns that insert, and this test only needs the row to
// exist, not to exercise the job).
it("keeps a run's ruleName snapshot after its rule is deleted, with ruleId set to null", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id);
    const created = await createAutomationRule(
      db,
      user.id,
      {
        name: "Rule to be deleted",
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
        VALUES (${created.value.id}, ${created.value.name}, ${dealId}, 'deal_created', 'success')
        RETURNING id
      `)
    ).rows[0] as { id: string } | undefined;
    if (runRow === undefined) throw new Error("no run row");

    const deleted = await deleteAutomationRule(db, created.value.id, sig());
    expect(deleted.ok).toBe(true);

    const survivingRun = (
      await db.execute(sql`SELECT rule_id, rule_name FROM automation_runs WHERE id = ${runRow.id}`)
    ).rows[0] as { rule_id: string | null; rule_name: string } | undefined;
    expect(survivingRun).toBeDefined();
    expect(survivingRun?.rule_id).toBeNull();
    expect(survivingRun?.rule_name).toBe("Rule to be deleted");
  });
});

it("returns AUTOMATION_NOT_FOUND for a missing rule id", async () => {
  await withTestDb(async (db) => {
    const result = await getAutomationRule(db, "00000000-0000-0000-0000-000000000000", sig());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.id).toBe("E_AUTOMATION_002");
  });
});
