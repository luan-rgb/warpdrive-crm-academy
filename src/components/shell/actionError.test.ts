import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { actionErrorContent } from "./actionError";

describe("actionErrorContent", () => {
  it("falls back to the generic copy for an unmapped id", () => {
    expect(actionErrorContent("E_NOT_A_REAL_ID").title).toBe("Não foi possível concluir essa ação");
  });

  // Convert-to-deal with no pipeline at all is a setup problem the user can fix themselves, and the
  // generic "something went wrong, please refresh" copy sends them in circles: refreshing never
  // helps. Naming the cause is the whole difference between a dead end and a next step.
  it("tells the user to create a pipeline when convert has no target", () => {
    const content = actionErrorContent(ERROR_IDS.LEAD_CONVERT_NO_PIPELINE);
    expect(content.title).not.toBe("Não foi possível concluir essa ação");
    expect(content.body).toMatch(/funil/i);
  });

  // A rejected saved filter is a fixable mistake in one condition, so the copy points at the
  // condition values instead of sending the user to refresh a page that fails the same way.
  it("tells the user which part of a rejected filter to fix", () => {
    const content = actionErrorContent(ERROR_IDS.DEAL_FILTER_INVALID);
    expect(content.title).not.toBe("Não foi possível concluir essa ação");
    expect(content.body).toMatch(/condição/i);
  });

  it("tells the user a lead was already converted", () => {
    const content = actionErrorContent(ERROR_IDS.LEAD_ALREADY_CONVERTED);
    expect(content.title).not.toBe("Não foi possível concluir essa ação");
    expect(content.body).toMatch(/negócio/i);
  });
});
