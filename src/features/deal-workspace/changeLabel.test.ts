import { describe, expect, it } from "vitest";
import { formatFieldValue } from "./changeLabel";

describe("formatFieldValue", () => {
  it("shows deal value changes in reais", () => {
    expect(formatFieldValue("value", "1500.00")).toBe("R$ 1.500");
    expect(formatFieldValue("value", null)).toBe("(nenhum)");
  });
});
