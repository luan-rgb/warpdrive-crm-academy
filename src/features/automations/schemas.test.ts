import { describe, expect, it } from "vitest";
import { createAutomationRuleInputSchema } from "./schemas";

const BASE = {
  name: "R",
  trigger: "deal_created",
  actions: [{ actionType: "send_notification", config: { messageTemplate: "x" } }],
};

describe("createAutomationRuleInputSchema", () => {
  it("defaults conditions to none", () => {
    const r = createAutomationRuleInputSchema.safeParse(BASE);
    expect(r.success && r.data.conditions).toEqual([]);
  });

  it("rejects a malformed condition at save time", () => {
    const r = createAutomationRuleInputSchema.safeParse({
      ...BASE,
      conditions: [{ field: "value", op: "gt", value: "muito" }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts the new update_field keys and rejects unknown ones", () => {
    const ok = createAutomationRuleInputSchema.safeParse({
      ...BASE,
      actions: [{ actionType: "update_field", config: { fieldKey: "stageId", value: "s1" } }],
    });
    expect(ok.success).toBe(true);
    const bad = createAutomationRuleInputSchema.safeParse({
      ...BASE,
      actions: [{ actionType: "update_field", config: { fieldKey: "deleted", value: "x" } }],
    });
    expect(bad.success).toBe(false);
  });

  it("requires an http(s) URL for a webhook action", () => {
    const bad = createAutomationRuleInputSchema.safeParse({
      ...BASE,
      actions: [{ actionType: "webhook", config: { url: "ftp://x" } }],
    });
    expect(bad.success).toBe(false);
    const ok = createAutomationRuleInputSchema.safeParse({
      ...BASE,
      actions: [{ actionType: "webhook", config: { url: "https://hooks.example.com/a" } }],
    });
    expect(ok.success).toBe(true);
  });
});
