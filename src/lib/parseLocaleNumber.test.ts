import { describe, expect, it } from "vitest";
import { parseLocaleNumber } from "./parseLocaleNumber";

describe("parseLocaleNumber", () => {
  it("parses a pt-BR thousands-and-decimal value", () => {
    expect(parseLocaleNumber("10.000,50")).toBe(10000.5);
  });

  it("parses a value with no thousands separator", () => {
    expect(parseLocaleNumber("10000,5")).toBe(10000.5);
  });

  it("parses a plain integer", () => {
    expect(parseLocaleNumber("10000")).toBe(10000);
  });

  it("returns null for blank input", () => {
    expect(parseLocaleNumber("  ")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(parseLocaleNumber("abc")).toBeNull();
  });
});
