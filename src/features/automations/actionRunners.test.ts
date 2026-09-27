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

function action(actionType: string, actionConfig: Record<string, unknown>) {
  return { id: "n/a", ruleId: "n/a", position: 0, actionType, actionConfig } as never;
}

it("add_note writes a note on the deal with the template rendered", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDealWithOwner(db, user.id);
    const r = await runAction(
      db,
      deal,
      action("add_note", { contentTemplate: "Negócio {{deal.title}} entrou na etapa" }),
      sig(),
    );
    expect(r.status).toBe("success");
    const note = (
      await db.execute(sql`SELECT body, author_id FROM notes WHERE entity_id = ${deal.id}`)
    ).rows[0] as { body: string; author_id: string } | undefined;
    expect(note?.body).toBe("Negócio Test Deal entrou na etapa");
    expect(note?.author_id).toBe(user.id);
  });
});

it("send_notification can target a chosen user instead of the owner", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const manager = await seedUser(db, { isAdmin: true });
    const deal = await seedDealWithOwner(db, owner.id);
    const r = await runAction(
      db,
      deal,
      action("send_notification", { messageTemplate: "Olhe isto", recipientId: manager.id }),
      sig(),
    );
    expect(r.status).toBe("success");
    const rows = (
      await db.execute(
        sql`SELECT user_id AS recipient_id FROM notifications WHERE entity_id = ${deal.id}`,
      )
    ).rows as { recipient_id: string }[];
    expect(rows.map((x) => x.recipient_id)).toEqual([manager.id]);
  });
});

it("update_field sets the deal value from a typed amount", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDealWithOwner(db, user.id);
    const r = await runAction(
      db,
      deal,
      action("update_field", { fieldKey: "value", value: "1500,5" }),
      sig(),
    );
    expect(r.status).toBe("success");
    const row = (await db.execute(sql`SELECT value FROM deals WHERE id = ${deal.id}`)).rows[0] as {
      value: string;
    };
    expect(row.value).toBe("1500.50");
  });
});

it("update_field refuses a stage from another pipeline, with a Portuguese reason", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDealWithOwner(db, user.id);
    const { stages } = await seedPipelineWithStages(db, ["Outra"]);
    const foreign = stages[0];
    if (foreign === undefined) throw new Error("no stage");
    const r = await runAction(
      db,
      deal,
      action("update_field", { fieldKey: "stageId", value: foreign.id }),
      sig(),
    );
    expect(r.status).toBe("error");
    expect(r.errorMessage).toMatch(/etapa não pertence ao funil/);
  });
});

it("update_field moves the deal to another stage of its pipeline", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["A", "B"]);
    const [a, b] = stages;
    if (a === undefined || b === undefined) throw new Error("no stages");
    const row = (
      await db.execute(sql`
        INSERT INTO deals (title, pipeline_id, stage_id, owner_id, visibility_level, status)
        VALUES ('D', ${pipeline.id}, ${a.id}, ${user.id}, 'all', 'open') RETURNING id`)
    ).rows[0] as { id: string };
    const r = await runAction(
      db,
      { id: row.id, ownerId: user.id },
      action("update_field", { fieldKey: "stageId", value: b.id }),
      sig(),
    );
    expect(r.status).toBe("success");
    const after = (await db.execute(sql`SELECT stage_id FROM deals WHERE id = ${row.id}`))
      .rows[0] as { stage_id: string };
    expect(after.stage_id).toBe(b.id);
  });
});

it("a missing email account is reported in Portuguese", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDealWithOwner(db, user.id);
    const r = await runAction(
      db,
      deal,
      action("send_email", { subjectTemplate: "a", bodyTemplate: "b" }),
      sig(),
    );
    expect(r.status).toBe("error");
    expect(r.errorMessage).toMatch(/não tem uma caixa de e-mail conectada/);
  });
});
