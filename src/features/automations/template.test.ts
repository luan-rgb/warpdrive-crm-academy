import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template";

describe("renderTemplate", () => {
  it("renders the deal value in reais, not the raw decimal", () => {
    expect(
      renderTemplate("Valor: {{deal.value}}", { title: "T", value: "25000.00", ownerName: "Ana" }),
    ).toBe("Valor: R$ 25.000");
  });

  it("an empty value renders as nothing", () => {
    expect(renderTemplate("[{{deal.value}}]", { title: "T", value: null, ownerName: "Ana" })).toBe(
      "[]",
    );
  });
});
