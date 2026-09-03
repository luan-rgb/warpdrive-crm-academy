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
        sql`SELECT ara.status FROM automation_run_actions ara
            JOIN automation_runs ar ON ar.id = ara.run_id
            WHERE ar.deal_id = ${dealId} ORDER BY ara.position`,
      )
    ).rows as { status: string }[];
    expect(actions.map((a) => a.status)).toEqual(["error", "success"]);
  });
});
