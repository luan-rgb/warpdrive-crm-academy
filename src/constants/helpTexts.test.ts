import { describe, expect, it } from "vitest";
import { HELP_TEXTS } from "./helpTexts";

describe("HELP_TEXTS", () => {
  it("every topic has a short title and a one-paragraph explanation", () => {
    for (const [key, t] of Object.entries(HELP_TEXTS)) {
      expect(t.title.length, key).toBeGreaterThan(2);
      expect(t.title.length, key).toBeLessThanOrEqual(48);
      expect(t.body.length, key).toBeGreaterThan(20);
      expect(t.body.length, key).toBeLessThanOrEqual(420);
    }
  });

  it("follows the repo's copy rules (no em dashes)", () => {
    for (const t of Object.values(HELP_TEXTS)) {
      expect(`${t.title} ${t.body}`).not.toMatch(/—/);
    }
  });

  it("covers every major area of the CRM", () => {
    const areas = new Set(Object.keys(HELP_TEXTS).map((k) => k.split(".")[0]));
    for (const area of [
      "pipeline",
      "deal",
      "lead",
      "contact",
      "org",
      "activity",
      "email",
      "automation",
      "dashboard",
      "goal",
      "product",
      "field",
      "import",
      "settings",
    ]) {
      expect(areas, area).toContain(area);
    }
  });
});
