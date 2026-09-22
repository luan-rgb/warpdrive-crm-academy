/**
 * magicLinkEmail.test.ts: TDD tests for sendMagicLinkEmail.
 *
 * Test plan:
 * (a) not configured (empty key/from) -> err, no fetch call.
 * (b) configured, Resend accepts -> ok, fetch called with the right auth header and recipient.
 * (c) configured, Resend rejects (non-2xx) -> err.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { type ResendConfig, sendMagicLinkEmail } from "./magicLinkEmail";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ARGS = {
  to: "student@example.com",
  verifyUrl: "https://x.test/auth/magic-link/verify?token=t",
};
const SIG = () => AbortSignal.timeout(1000);

describe("sendMagicLinkEmail", () => {
  test("not configured: err, no network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const config: ResendConfig = { apiKey: "", fromEmail: "" };
    const result = await sendMagicLinkEmail(ARGS, { config, signal: SIG() });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("configured, Resend accepts: ok, sends with bearer auth and the right recipient", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const config: ResendConfig = { apiKey: "re_test_key", fromEmail: "login@example.com" };
    const result = await sendMagicLinkEmail(ARGS, { config, signal: SIG() });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test_key" });
    const body = JSON.parse(init.body as string) as { to: string; from: string };
    expect(body.to).toBe("student@example.com");
    expect(body.from).toBe("login@example.com");
  });

  test("configured, Resend rejects: err", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 422 })));

    const config: ResendConfig = { apiKey: "re_test_key", fromEmail: "login@example.com" };
    const result = await sendMagicLinkEmail(ARGS, { config, signal: SIG() });

    expect(result.ok).toBe(false);
  });
});
