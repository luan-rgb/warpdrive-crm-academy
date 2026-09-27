import { describe, expect, it } from "vitest";
import { isoToDayHeading, isoToDayLabel } from "./dayHeading";

describe("isoToDayHeading", () => {
  it("formats an ISO date as weekday + day-of-month", () => {
    // 2026-06-28 is a Sunday, 2026-06-29 a Monday (matches the seeded week).
    expect(isoToDayHeading("2026-06-28")).toBe("Dom 28");
    expect(isoToDayHeading("2026-06-29")).toBe("Seg 29");
  });

  it("is timezone-independent (parses the date parts directly)", () => {
    expect(isoToDayHeading("2026-07-04")).toBe("Sáb 4");
  });
});

describe("isoToDayLabel", () => {
  it("spells the day out in Portuguese for screen readers", () => {
    expect(isoToDayLabel("2026-08-31")).toBe("Segunda-feira, 31 de agosto de 2026");
  });
});
