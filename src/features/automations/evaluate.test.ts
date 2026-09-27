import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema/deals";
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
    await seedRule(db, user.id, {
      trigger: "deal_stage_changed",
      triggerConfig: { toStageId: null },
    });
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

it("skips a rule whose conditions the deal does not meet, and matches once it does", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const ruleId = await seedRule(db, user.id, { trigger: "deal_created" });
    await db.execute(sql`
      UPDATE automation_rules
      SET conditions = ${JSON.stringify([{ field: "value", op: "gt", value: "10000" }])}::jsonb
      WHERE id = ${ruleId}`);
    const seeded = await seedDeal(db, user.id, pipeline.id, stage.id);
    await db.execute(sql`UPDATE deals SET value = 5000 WHERE id = ${seeded.id}`);
    const [small] = await db.select().from(deals).where(eq(deals.id, seeded.id));
    if (small === undefined) throw new Error("no deal");

    expect(await matchAutomationRules(db, "deal_created", null, small, sig())).toEqual([]);
    const matched = await matchAutomationRules(
      db,
      "deal_created",
      null,
      { ...small, value: "20000.00" },
      sig(),
    );
    expect(matched.map((r) => r.id)).toEqual([ruleId]);
  });
});

it("an activity trigger matches any activity event on a deal in scope", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const ruleId = await seedRule(db, user.id, { trigger: "activity_completed" });
    const seeded = await seedDeal(db, user.id, pipeline.id, stage.id);
    const [deal] = await db.select().from(deals).where(eq(deals.id, seeded.id));
    if (deal === undefined) throw new Error("no deal");

    const matched = await matchAutomationRules(db, "activity_completed", deal, deal, sig());
    expect(matched.map((r) => r.id)).toEqual([ruleId]);
  });
});
