import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
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
