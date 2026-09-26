// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/config/env";

vi.mock("@/db/client", () => ({ db: {} }));
const logoutCore = vi.fn(() => Promise.resolve());
vi.mock("@/features/auth/logout", () => ({ logoutCore }));
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (k: string) => (cookieStore.has(k) ? { value: cookieStore.get(k) } : undefined),
    }),
}));

const { GET, POST } = await import("./route");

function post(token: string | null, headers: Record<string, string>): NextRequest {
  const body = new FormData();
  if (token !== null) body.set("csrf", token);
  return new NextRequest("https://crm.example.com/auth/logout", { method: "POST", body, headers });
}

describe("/auth/logout", () => {
  beforeEach(() => {
    logoutCore.mockClear();
    cookieStore.clear();
    cookieStore.set("wd_sid", "sid");
    cookieStore.set("wd_csrf", "tok");
  });

  // A link or <img> on any page could otherwise sign the user out of every session.
  it("does not log out on a GET", () => {
    const res = GET();
    expect(logoutCore).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie") ?? "").not.toContain("wd_sid=;");
  });

  it("refuses a cross-site POST or one without the CSRF token", async () => {
    await POST(post(null, { "sec-fetch-site": "same-origin" }));
    await POST(post("tok", { "sec-fetch-site": "cross-site" }));
    expect(logoutCore).not.toHaveBeenCalled();
  });

  it("logs out on a same-site POST carrying the CSRF token", async () => {
    const res = await POST(
      post("tok", {
        "sec-fetch-site": "same-origin",
        origin: new URL(env.BASE_URL).origin,
      }),
    );
    expect(logoutCore).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toContain("/login");
  });
});
