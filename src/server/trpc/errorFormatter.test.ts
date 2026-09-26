import { describe, expect, it } from "vitest";
import { redactErrorShape } from "./errorFormatter";

const shape = (message: string, code: string) => ({
  message,
  code: -32603,
  data: { code, httpStatus: 500, path: "deals.list", stack: "Error: at db.ts:1" },
});

describe("redactErrorShape", () => {
  it("replaces an unexpected server error (SQL text, bound values) with a generic message", () => {
    const leaked = "Failed query: select * from persons where email = $1\nparams: ana@acme.com";
    const out = redactErrorShape(shape(leaked, "INTERNAL_SERVER_ERROR"));
    expect(out.message).toBe("E_INTERNAL_001");
    expect(JSON.stringify(out)).not.toContain("ana@acme.com");
    expect(out.data.stack).toBeUndefined();
  });

  it("keeps the app's own error ids, which the UI maps to messages", () => {
    const out = redactErrorShape(shape("E_DEAL_001", "NOT_FOUND"));
    expect(out.message).toBe("E_DEAL_001");
  });

  it("keeps messages of expected client errors (bad input, auth)", () => {
    const out = redactErrorShape(shape("E_AUTH_003", "UNAUTHORIZED"));
    expect(out.message).toBe("E_AUTH_003");
  });
});
