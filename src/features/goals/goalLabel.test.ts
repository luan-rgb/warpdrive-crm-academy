import { describe, expect, test } from "vitest";
import { goalLabel } from "./goalLabel";

const g = {
  subject: "deal" as const,
  action: "won" as const,
  metric: "value" as const,
  interval: "monthly" as const,
};

describe("goalLabel", () => {
  test("names a deal value goal", () => {
    expect(goalLabel(g)).toBe("Valor de negócios ganhos, mensal");
  });

  test("names a deal count goal", () => {
    expect(goalLabel({ ...g, metric: "count" })).toBe("Negócios ganhos, mensal");
  });

  test("names an activity completion goal", () => {
    expect(
      goalLabel({ subject: "activity", action: "completed", metric: "count", interval: "weekly" }),
    ).toBe("Atividades concluídas, semanal");
  });

  test("names deals added quarterly", () => {
    expect(goalLabel({ ...g, action: "added", metric: "count", interval: "quarterly" })).toBe(
      "Negócios adicionados, trimestral",
    );
  });

  test("names a yearly lost-deal goal", () => {
    expect(goalLabel({ ...g, action: "lost", metric: "count", interval: "yearly" })).toBe(
      "Negócios perdidos, anual",
    );
  });
});
