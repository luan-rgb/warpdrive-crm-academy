import { describe, expect, test } from "vitest";
import { AUTOMATION_RUN_ACTION_STATUS, AUTOMATION_RUN_STATUS } from "@/db/schema/automations";
import { runActionStatusPresentation, runStatusPresentation } from "./runHistoryStatus";

describe("runStatusPresentation", () => {
  test.each(AUTOMATION_RUN_STATUS)("maps %s to a defined label and tone", (status) => {
    const presentation = runStatusPresentation(status);
    expect(presentation.label).toBeTypeOf("string");
    expect(presentation.label.length).toBeGreaterThan(0);
    expect(["success", "error", "warning"]).toContain(presentation.tone);
  });
});

describe("runActionStatusPresentation", () => {
  test.each(AUTOMATION_RUN_ACTION_STATUS)("maps %s to a defined label and tone", (status) => {
    const presentation = runActionStatusPresentation(status);
    expect(presentation.label).toBeTypeOf("string");
    expect(presentation.label.length).toBeGreaterThan(0);
    expect(["success", "error", "warning"]).toContain(presentation.tone);
  });
});
