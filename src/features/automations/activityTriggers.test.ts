import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { triggerActivityAutomations } from "./activityTriggers";

const sig = () => new AbortController().signal;

it("an activity on a deal fires the matching activity rules; one without a deal fires none", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const deal = (
      await db.execute(sql`
        INSERT INTO deals (title, pipeline_id, stage_id, owner_id, visibility_level, status)
        VALUES ('D', ${pipeline.id}, ${stage.id}, ${user.id}, 'all', 'open') RETURNING id`)
    ).rows[0] as { id: string };
    const rule = (
      await db.execute(sql`
        INSERT INTO automation_rules (name, trigger, owner_id)
        VALUES ('Ao concluir', 'activity_completed', ${user.id}) RETURNING id`)
    ).rows[0] as { id: string };
    await db.execute(sql`
      INSERT INTO automation_rules (name, trigger, owner_id)
      VALUES ('Ao criar', 'activity_created', ${user.id})`);

    const fired = await triggerActivityAutomations(
      db,
      { dealId: deal.id },
      "activity_completed",
      sig(),
    );
    expect(fired).toEqual([rule.id]);
    expect(
      await triggerActivityAutomations(db, { dealId: null }, "activity_completed", sig()),
    ).toEqual([]);
  });
});
