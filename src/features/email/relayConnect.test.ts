import { describe, expect, it } from "vitest";
import { claimRelayMailbox, requestConsentUrl, tenantSlugFromBaseUrl } from "./relayConnect";

const signal = (): AbortSignal => new AbortController().signal;

describe("tenantSlugFromBaseUrl", () => {
  it("is the first label of the tenant host", () => {
    expect(tenantSlugFromBaseUrl("https://estrategistacrm.crm.estrategistacrm.com.br")).toBe(
      "estrategistacrm",
    );
  });
});

describe("requestConsentUrl", () => {
  const args = {
    relayUrl: "http://relay:8081",
    secret: "s".repeat(40),
    tenantSlug: "aluno",
    userId: "11111111-1111-1111-1111-111111111111",
  };

  it("asks the relay with the shared secret and maps gmail/outlook to its provider names", async () => {
    const seen: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetchImpl = (url: string, init: RequestInit) => {
      seen.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string) as unknown,
      });
      return Promise.resolve(Response.json({ authUrl: "https://accounts.google.com/x" }));
    };
    const r = await requestConsentUrl(
      { ...args, provider: "gmail" },
      fetchImpl as typeof fetch,
      signal(),
    );
    expect(r).toEqual({ ok: true, value: { url: "https://accounts.google.com/x" } });
    expect(seen[0]?.url).toBe("http://relay:8081/connect-init");
    expect(seen[0]?.headers["x-relay-secret"]).toBe(args.secret);
    expect(seen[0]?.body).toEqual({
      tenant_slug: "aluno",
      user_id: args.userId,
      provider: "google",
    });

    await requestConsentUrl({ ...args, provider: "outlook" }, fetchImpl as typeof fetch, signal());
    expect((seen[1]?.body as { provider: string }).provider).toBe("microsoft");
  });

  it("a relay refusal is an error value, not a throw", async () => {
    const fetchImpl = () => Promise.resolve(Response.json({ error: "x" }, { status: 503 }));
    const r = await requestConsentUrl({ ...args, provider: "gmail" }, fetchImpl, signal());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.id).toBe("E_MAIL_007");
      expect(r.error.context?.status).toBe(503);
    }
  });

  it("an unreachable relay is an error value too", async () => {
    const fetchImpl = () => Promise.reject(new TypeError("fetch failed"));
    const r = await requestConsentUrl({ ...args, provider: "gmail" }, fetchImpl, signal());
    expect(r.ok).toBe(false);
  });
});

describe("claimRelayMailbox", () => {
  const args = {
    relayUrl: "http://relay:8081",
    secret: "t".repeat(64),
    tenantSlug: "aluno",
    userId: "11111111-1111-1111-1111-111111111111",
    ticket: "tk_abc",
  };

  it("claims the ticket for this tenant and user with the tenant's secret", async () => {
    const seen: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetchImpl = (url: string, init: RequestInit) => {
      seen.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string) as unknown,
      });
      return Promise.resolve(
        Response.json({
          provider: "gmail",
          email: "a@gmail.com",
          refreshToken: "rt",
          scopes: ["x"],
        }),
      );
    };
    const r = await claimRelayMailbox(args, fetchImpl as typeof fetch, signal());
    expect(r).toEqual({
      ok: true,
      value: { provider: "gmail", email: "a@gmail.com", refreshToken: "rt", scopes: ["x"] },
    });
    expect(seen[0]?.url).toBe("http://relay:8081/claim");
    expect(seen[0]?.headers["x-relay-secret"]).toBe(args.secret);
    expect(seen[0]?.body).toEqual({ tenant_slug: "aluno", user_id: args.userId, ticket: "tk_abc" });
  });

  it("reports a refused claim (other user, expired, reused) as E_MAIL_009", async () => {
    const fetchImpl = () => Promise.resolve(Response.json({ error: "not_found" }, { status: 404 }));
    const r = await claimRelayMailbox(args, fetchImpl, signal());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.id).toBe("E_MAIL_009");
  });
});
