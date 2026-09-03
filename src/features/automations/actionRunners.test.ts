import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { runAction } from "./actionRunners";

const sig = () => new AbortController().signal;

async function seedDealWithOwner(
  db: Db,
  ownerId: string,
): Promise<{ id: string; ownerId: string }> {
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

// 'call' is a system-seeded key (migration 0007); a fixed literal collides across test runs
// sharing that seed. A random key keeps this insert independent of the seed data.
async function seedActivityType(db: Db): Promise<string> {
  const key = `test_${randomUUID()}`;
  const row = (
    await db.execute(sql`
      INSERT INTO activity_types (key, name, "order") VALUES (${key}, 'Call', 0) RETURNING id
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
    const row = (await db.execute(sql`SELECT title FROM deals WHERE id = ${deal.id}`)).rows[0] as
      | { title: string }
      | undefined;
    expect(row?.title).toBe("Automated Title");
  });
});
