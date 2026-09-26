// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { RATE_LIMITS } from "@/constants/rateLimits";
import { resetRateLimitsForTest } from "@/server/rateLimitGuard";

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/mcp/server", () => ({ registerMcpTools: () => undefined }));
vi.mock("@/features/mcp/auth", () => ({
  authenticateMcp: () =>
    Promise.resolve({
      ok: true,
      value: {
        ctx: { db: {}, session: null, actor: { id: "user-1" } },
        authInfo: {
          token: "t",
          clientId: "c",
          scopes: [],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    }),
}));

const { POST } = await import("./route");

function call(): Promise<Response> {
  return POST(
    new Request("https://crm.example.com/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }),
  );
}

beforeEach(() => resetRateLimitsForTest());

it("caps how fast one user's MCP client can call the CRM", async () => {
  for (let i = 0; i < RATE_LIMITS.mcp.limit; i++) {
    expect((await call()).status).not.toBe(429);
  }
  expect((await call()).status).toBe(429);
});
