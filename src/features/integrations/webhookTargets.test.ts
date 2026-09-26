// @vitest-environment node
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { createAutomationRule } from "@/features/automations/rulesRepo";
import { listWebhookTargets } from "./webhookTargets";

const sig = () => new AbortController().signal;

describe("listWebhookTargets", () => {
  it("lists every automation that calls a webhook, with only the host of its URL", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const base = {
        description: null,
        pipelineId: null,
        trigger: "deal_created" as const,
        triggerConfig: {},
        conditions: [],
      };
      await createAutomationRule(
        db,
        user.id,
        {
          ...base,
          name: "Avisar Zapier",
          isActive: false,
          actions: [
            { actionType: "webhook", config: { url: "https://hooks.zapier.com/x?token=s" } },
          ],
        },
        sig(),
      );
      await createAutomationRule(
        db,
        user.id,
        {
          ...base,
          name: "Só notificação",
          isActive: true,
          actions: [{ actionType: "send_notification", config: { messageTemplate: "oi" } }],
        },
        sig(),
      );

      const rows = await listWebhookTargets(db, sig());
      expect(rows).toEqual([
        expect.objectContaining({
          ruleName: "Avisar Zapier",
          host: "hooks.zapier.com",
          isActive: false,
        }),
      ]);
    });
  });
});
