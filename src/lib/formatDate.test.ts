import { describe, expect, it } from "vitest";
import { formatDateTimePtBr, formatMediumDate } from "./formatDate";

describe("formatMediumDate", () => {
  it("formats a YYYY-MM-DD date as 'Mon D, YYYY'", () => {
    expect(formatMediumDate("2026-07-16")).toBe("Jul 16, 2026");
  });

  it("returns the raw string when it is not a parseable date", () => {
    expect(formatMediumDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDateTimePtBr", () => {
  it("renders day/month/year and 24h time in Brazilian Portuguese", () => {
    const d = new Date(2026, 8, 20, 14, 5);
    expect(formatDateTimePtBr(d)).toBe("20/09/2026, 14:05");
  });
});
