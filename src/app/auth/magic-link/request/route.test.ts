// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITS } from "@/constants/rateLimits";
import { resetRateLimitsForTest } from "@/server/rateLimitGuard";

vi.mock("@/db/client", () => ({ db: {} }));
const send = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }));
vi.mock("@/features/auth/magicLinkEmail", () => ({ sendMagicLinkEmail: send }));
vi.mock("@/features/auth/magicLink", () => ({
  requestMagicLink: (raw: unknown) =>
    Promise.resolve({ ok: true as const, value: { token: "t", email: String(raw).toLowerCase() } }),
}));

const { POST } = await import("./route");

function request(email: string, ip: string): NextRequest {
  const body = new FormData();
  body.set("email", email);
  return new NextRequest("https://crm.example.com/auth/magic-link/request", {
    method: "POST",
    body,
    headers: { "x-forwarded-for": ip },
  });
}

describe("POST /auth/magic-link/request", () => {
  beforeEach(() => {
    resetRateLimitsForTest();
    send.mockClear();
  });

  it("stops flooding one inbox even when every request comes from a different address", async () => {
    const limit = RATE_LIMITS.authMagicLinkPerEmail.limit;
    for (let i = 0; i < limit; i++) {
      const res = await POST(request("Ana@Acme.com", `203.0.113.${i + 1}`));
      expect(res.status).toBe(307);
    }
    const blocked = await POST(request("ana@acme.com", "198.51.100.9"));
    expect(blocked.status).toBe(429);
    expect(send).toHaveBeenCalledTimes(limit);
  });
});
