import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { handleAutomationExecuteJob } from "./job";
import { createAutomationRule } from "./rulesRepo";

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
        conditions: [],
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
        sql`SELECT ara.status FROM automation_run_actions ara
            JOIN automation_runs ar ON ar.id = ara.run_id
            WHERE ar.deal_id = ${dealId}`,
      )
    ).rows as { status: string }[];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.status).toBe("success");
  });
});

// Recursion guard (design spec Testing section): an update_field action targeting the SAME
// field a deal_field_changed rule watches must not cause that rule to fire again. runUpdateField
// deliberately never calls matchAutomationRules/evaluateAutomations/enqueueAutomationRuns (see
// its doc comment in actionRunners.ts): it writes the column, records the change, and publishes
// the board event directly instead of going through updateDeal(), which is the only path that
// evaluates deal_field_changed rules. If that guard ever regressed, this job execution's own
// update_field action would enqueue (and, since requireBoss() is null in tests, silently no-op
// enqueueing) a second automation_runs row for the same deal; asserting exactly one row proves
// no recursive run happened.
it("update_field targeting the field its own trigger watches does not re-fire the rule", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id);
    const rule = await createAutomationRule(
      db,
      user.id,
      {
        name: "Self-updating title rule",
        description: null,
        pipelineId: null,
        trigger: "deal_field_changed",
        triggerConfig: { fieldKey: "title" },
        conditions: [],
        actions: [
          { actionType: "update_field", config: { fieldKey: "title", value: "Automated" } },
        ],
        isActive: true,
      },
      sig(),
    );
    if (!rule.ok) throw new Error("setup failed");

    await handleAutomationExecuteJob(
      db,
      { data: { ruleId: rule.value.id, dealId, trigger: "deal_field_changed" } },
      sig(),
    );

    const runs = (await db.execute(sql`SELECT id FROM automation_runs WHERE deal_id = ${dealId}`))
      .rows;
    expect(runs).toHaveLength(1);

    const dealRow = (await db.execute(sql`SELECT title FROM deals WHERE id = ${dealId}`)).rows[0] as
      | { title: string }
      | undefined;
    expect(dealRow?.title).toBe("Automated");
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
        conditions: [],
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
        sql`SELECT ara.status FROM automation_run_actions ara
            JOIN automation_runs ar ON ar.id = ara.run_id
            WHERE ar.deal_id = ${dealId} ORDER BY ara.position`,
      )
    ).rows as { status: string }[];
    expect(actions.map((a) => a.status)).toEqual(["error", "success"]);
  });
});
