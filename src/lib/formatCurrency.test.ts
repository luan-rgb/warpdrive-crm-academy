import { describe, expect, it } from "vitest";
import { formatCurrency } from "./formatCurrency";

describe("formatCurrency", () => {
  it("formats a decimal string as a whole-currency amount with a thousands separator", () => {
    expect(formatCurrency("25000.00")).toBe("R$ 25.000");
  });

  it("rounds fractional cents to whole currency", () => {
    expect(formatCurrency("1234567.89")).toBe("R$ 1.234.568");
  });

  it("formats zero", () => {
    expect(formatCurrency("0")).toBe("R$ 0");
  });

  it("accepts a number", () => {
    expect(formatCurrency(4200)).toBe("R$ 4.200");
  });

  it("returns empty string for non-numeric input", () => {
    expect(formatCurrency("abc")).toBe("");
  });

  it("honors a non-default currency", () => {
    expect(formatCurrency("1000", "EUR")).toBe("€ 1.000");
  });
});
