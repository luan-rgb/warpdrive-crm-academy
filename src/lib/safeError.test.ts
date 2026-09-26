import { describe, expect, it } from "vitest";
import { AppError } from "@/constants/errorIds";
import { safeErrorSummary } from "./safeError";

describe("safeErrorSummary", () => {
  it("keeps what identifies the failure but never the message, which can hold SQL and values", () => {
    const dbError = Object.assign(new Error("Failed query: insert ... params: ana@acme.com"), {
      cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
    });
    const out = safeErrorSummary(dbError);
    expect(out).toEqual({ name: "Error", pgCode: "23505" });
    expect(JSON.stringify(out)).not.toContain("ana@acme.com");
  });

  it("includes the app error id", () => {
    expect(safeErrorSummary(new AppError("E_DEAL_001", "not found", { email: "x@y.z" }))).toEqual({
      name: "AppError",
      id: "E_DEAL_001",
    });
  });

  it("handles non-errors", () => {
    expect(safeErrorSummary("boom")).toEqual({ name: "string" });
  });
});
