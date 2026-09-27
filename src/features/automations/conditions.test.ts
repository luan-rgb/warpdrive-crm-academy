import { describe, expect, it } from "vitest";
import {
  type AutomationCondition,
  automationConditionsSchema,
  dealMatchesConditions,
} from "./conditions";

const DEAL = {
  title: "Renovação Acme",
  value: "15000.00",
  stageId: "s-2",
  ownerId: "u-1",
  status: "open" as const,
  labels: ["Quente"],
  expectedCloseDate: "2026-10-15",
};

const match = (conditions: AutomationCondition[]) => dealMatchesConditions(DEAL, conditions);

describe("dealMatchesConditions", () => {
  it("no conditions always matches", () => {
    expect(match([])).toBe(true);
  });

  it("compares the deal value as a number", () => {
    expect(match([{ field: "value", op: "gt", value: "10000" }])).toBe(true);
    expect(match([{ field: "value", op: "gt", value: "20000" }])).toBe(false);
    expect(match([{ field: "value", op: "lte", value: "15000" }])).toBe(true);
  });

  it("a deal with no value fails every numeric comparison", () => {
    expect(
      dealMatchesConditions({ ...DEAL, value: null }, [{ field: "value", op: "lt", value: "1" }]),
    ).toBe(false);
  });

  it("matches stage, owner and status by identity", () => {
    expect(match([{ field: "stageId", op: "eq", value: "s-2" }])).toBe(true);
    expect(match([{ field: "stageId", op: "neq", value: "s-2" }])).toBe(false);
    expect(match([{ field: "ownerId", op: "eq", value: "u-9" }])).toBe(false);
    expect(match([{ field: "status", op: "eq", value: "open" }])).toBe(true);
  });

  it("checks labels and title text case-insensitively", () => {
    expect(match([{ field: "labels", op: "contains", value: "quente" }])).toBe(true);
    expect(match([{ field: "labels", op: "notContains", value: "Frio" }])).toBe(true);
    expect(match([{ field: "title", op: "contains", value: "acme" }])).toBe(true);
  });

  it("compares the expected close date", () => {
    expect(match([{ field: "expectedCloseDate", op: "lt", value: "2026-11-01" }])).toBe(true);
    expect(match([{ field: "expectedCloseDate", op: "isEmpty", value: "" }])).toBe(false);
  });

  it("requires every condition (AND)", () => {
    expect(
      match([
        { field: "value", op: "gt", value: "10000" },
        { field: "ownerId", op: "eq", value: "u-9" },
      ]),
    ).toBe(false);
  });
});

describe("automationConditionsSchema", () => {
  it("rejects an operator that makes no sense for the field", () => {
    expect(
      automationConditionsSchema.safeParse([{ field: "ownerId", op: "gt", value: "x" }]).success,
    ).toBe(false);
    expect(
      automationConditionsSchema.safeParse([{ field: "value", op: "gt", value: "abc" }]).success,
    ).toBe(false);
    expect(
      automationConditionsSchema.safeParse([{ field: "value", op: "gt", value: "10" }]).success,
    ).toBe(true);
  });
});
