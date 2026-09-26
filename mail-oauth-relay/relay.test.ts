// Tests for the central mail OAuth relay (mail-oauth-relay/lib.mjs). The tenant and ops databases
// are real Postgres databases from the shared test harness (makeTestDb), never mocks.
import { afterEach, describe, expect, it } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  buildAuthUrl,
  claimResult,
  completeCallback,
  connectInit,
  ensureOpsSchema,
  isValidSlug,
  tenantSecret,
} from "./lib.mjs";

const CFG = {
  baseDomain: "crm.example.com",
  relaySecret: "s".repeat(40),
  google: { clientId: "g-id", clientSecret: "g-secret" },
  microsoft: { clientId: "m-id", clientSecret: "m-secret" },
};

const open: TestDb[] = [];
afterEach(async () => {
  for (const t of open.splice(0)) await t.close();
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
// Each tenant holds only its own derived secret, never the relay's master secret.
const ALUNO_SECRET = tenantSecret(CFG.relaySecret, "aluno");

async function dbs() {
  const ops = await makeTestDb();
  open.push(ops);
  const opsQuery = (text: string, params: unknown[]) => ops.pool.query(text, params);
  await ensureOpsSchema(opsQuery);
  return { ops, opsQuery, userId: USER_ID };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Fake Google/Microsoft token + identity endpoints (the external OAuth providers are the one thing
// a test cannot talk to for real).
function providerFetch(opts: { email: string; refresh?: string | null }) {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: typeof init.body === "string" ? init.body : "" });
    if (url.includes("/token")) {
      const tokens: Record<string, unknown> = { access_token: "at", expires_in: 3600 };
      if (opts.refresh !== null) tokens.refresh_token = opts.refresh ?? "rt-1";
      return Promise.resolve(json(200, tokens));
    }
    if (url.includes("userinfo")) {
      return Promise.resolve(json(200, { email: opts.email, email_verified: true }));
    }
    if (url.includes("graph.microsoft.com")) {
      return Promise.resolve(json(200, { mail: opts.email, userPrincipalName: opts.email }));
    }
    return Promise.resolve(json(404, {}));
  };
  return { calls, fetchImpl };
}

describe("pure helpers", () => {
  it("only accepts tenant slugs that are safe as a subdomain", () => {
    expect(isValidSlug("estrategistacrm")).toBe(true);
    expect(isValidSlug("joao-silva")).toBe(true);
    expect(isValidSlug("../etc")).toBe(false);
    expect(isValidSlug("a b")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });

  it("derives a different secret per tenant, so one tenant cannot act for another", () => {
    expect(tenantSecret(CFG.relaySecret, "aluno")).toMatch(/^[0-9a-f]{64}$/);
    expect(tenantSecret(CFG.relaySecret, "aluno")).not.toBe(tenantSecret(CFG.relaySecret, "outro"));
  });

  it("builds a Google consent URL that asks for offline Gmail access, with no domain lock", () => {
    const u = new URL(buildAuthUrl(CFG, "google", "st"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://crm.example.com/api/mail-oauth/google/callback",
    );
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toContain("gmail.modify");
    expect(u.searchParams.get("hd")).toBeNull();
    expect(u.searchParams.get("state")).toBe("st");
  });

  it("builds a Microsoft consent URL on the common endpoint (personal and work accounts)", () => {
    const u = new URL(buildAuthUrl(CFG, "microsoft", "st"));
    expect(u.origin + u.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(u.searchParams.get("scope")).toContain("offline_access");
    expect(u.searchParams.get("scope")).toContain("Mail.Send");
  });
});

describe("connectInit", () => {
  it("refuses callers without this tenant's secret", async () => {
    const { opsQuery, userId } = await dbs();
    const body = { tenant_slug: "aluno", user_id: userId, provider: "google" };
    expect((await connectInit({ opsQuery, cfg: CFG }, body, "wrong")).status).toBe(401);
    // The master secret itself and another tenant's secret are refused too.
    expect((await connectInit({ opsQuery, cfg: CFG }, body, CFG.relaySecret)).status).toBe(401);
    const other = tenantSecret(CFG.relaySecret, "outro");
    expect((await connectInit({ opsQuery, cfg: CFG }, body, other)).status).toBe(401);
  });

  it("rejects an unsafe slug or unknown provider", async () => {
    const { opsQuery, userId } = await dbs();
    const bad = await connectInit(
      { opsQuery, cfg: CFG },
      { tenant_slug: "../x", user_id: userId, provider: "google" },
      tenantSecret(CFG.relaySecret, "../x"),
    );
    expect(bad.status).toBe(400);
    const badProvider = await connectInit(
      { opsQuery, cfg: CFG },
      { tenant_slug: "aluno", user_id: userId, provider: "yahoo" },
      ALUNO_SECRET,
    );
    expect(badProvider.status).toBe(400);
  });

  it("records a single-use state and returns the consent URL carrying it", async () => {
    const { ops, opsQuery, userId } = await dbs();
    const r = await connectInit(
      { opsQuery, cfg: CFG },
      { tenant_slug: "aluno", user_id: userId, provider: "microsoft" },
      ALUNO_SECRET,
    );
    expect(r.status).toBe(200);
    const state = new URL(r.body.authUrl).searchParams.get("state");
    const row = (
      await ops.pool.query("SELECT tenant_slug, provider FROM mail_oauth_requests WHERE state=$1", [
        state,
      ])
    ).rows[0];
    expect(row).toEqual({ tenant_slug: "aluno", provider: "microsoft" });
  });
});

describe("completeCallback + claimResult", () => {
  async function start(provider: "google" | "microsoft") {
    const ctx = await dbs();
    const init = await connectInit(
      { opsQuery: ctx.opsQuery, cfg: CFG },
      { tenant_slug: "aluno", user_id: ctx.userId, provider },
      ALUNO_SECRET,
    );
    const state = new URL(init.body.authUrl).searchParams.get("state") ?? "";
    return { ...ctx, state };
  }

  function deps(ctx: Awaited<ReturnType<typeof start>>, fetchImpl: typeof fetch) {
    return { opsQuery: ctx.opsQuery, fetchImpl, cfg: CFG };
  }

  function ticketOf(location: string): string {
    const u = new URL(location);
    expect(u.origin + u.pathname).toBe("https://aluno.crm.example.com/api/mail-oauth/complete");
    return u.searchParams.get("ticket") ?? "";
  }

  it("hands the result to the tenant only for the user who started the connection", async () => {
    const ctx = await start("google");
    const p = providerFetch({ email: "Aluno@Gmail.com" });
    const location = await completeCallback(
      deps(ctx, p.fetchImpl as typeof fetch),
      "google",
      new URLSearchParams({ code: "c", state: ctx.state }),
    );
    const ticket = ticketOf(location);
    expect(ticket).toMatch(/^[\w-]{40,}$/);
    expect(p.calls[0]?.body).toContain(
      "redirect_uri=https%3A%2F%2Fcrm.example.com%2Fapi%2Fmail-oauth%2Fgoogle%2Fcallback",
    );

    // The refresh token is never stored in plain text while it waits to be claimed.
    const stored = (await ctx.ops.pool.query("SELECT * FROM mail_oauth_requests")).rows[0];
    expect(JSON.stringify(stored)).not.toContain("rt-1");

    const claimDeps = { opsQuery: ctx.opsQuery, cfg: CFG };
    // Someone else logged in to the same tenant (the victim of a forwarded link) cannot claim it.
    const wrongUser = await claimResult(
      claimDeps,
      { tenant_slug: "aluno", user_id: OTHER_USER_ID, ticket },
      ALUNO_SECRET,
    );
    expect(wrongUser.status).toBe(404);
    // Another tenant cannot claim it either.
    const wrongTenant = await claimResult(
      claimDeps,
      { tenant_slug: "outro", user_id: ctx.userId, ticket },
      tenantSecret(CFG.relaySecret, "outro"),
    );
    expect(wrongTenant.status).toBe(404);

    const claimed = await claimResult(
      claimDeps,
      { tenant_slug: "aluno", user_id: ctx.userId, ticket },
      ALUNO_SECRET,
    );
    expect(claimed).toEqual({
      status: 200,
      body: {
        provider: "gmail",
        email: "aluno@gmail.com",
        refreshToken: "rt-1",
        scopes: expect.any(Array),
      },
    });
    const again = await claimResult(
      claimDeps,
      { tenant_slug: "aluno", user_id: ctx.userId, ticket },
      ALUNO_SECRET,
    );
    expect(again.status).toBe(404);
  });

  it("Microsoft: the claimed mailbox is an outlook one", async () => {
    const ctx = await start("microsoft");
    const p = providerFetch({ email: "aluno@outlook.com" });
    const ticket = ticketOf(
      await completeCallback(
        deps(ctx, p.fetchImpl as typeof fetch),
        "microsoft",
        new URLSearchParams({ code: "c", state: ctx.state }),
      ),
    );
    const claimed = await claimResult(
      { opsQuery: ctx.opsQuery, cfg: CFG },
      { tenant_slug: "aluno", user_id: ctx.userId, ticket },
      ALUNO_SECRET,
    );
    expect(claimed.body).toMatchObject({ provider: "outlook", email: "aluno@outlook.com" });
  });

  it("claim needs this tenant's secret", async () => {
    const ctx = await start("google");
    const r = await claimResult(
      { opsQuery: ctx.opsQuery, cfg: CFG },
      { tenant_slug: "aluno", user_id: ctx.userId, ticket: "x" },
      "wrong",
    );
    expect(r.status).toBe(401);
  });

  it("a state can be used once only", async () => {
    const ctx = await start("google");
    const p = providerFetch({ email: "aluno@gmail.com" });
    const q = new URLSearchParams({ code: "c", state: ctx.state });
    await completeCallback(deps(ctx, p.fetchImpl as typeof fetch), "google", q);
    const replay = await completeCallback(deps(ctx, p.fetchImpl as typeof fetch), "google", q);
    expect(replay).toBe("https://crm.example.com/");
  });

  it("a state minted for Google cannot complete the Microsoft callback", async () => {
    const ctx = await start("google");
    const p = providerFetch({ email: "aluno@gmail.com" });
    const location = await completeCallback(
      deps(ctx, p.fetchImpl as typeof fetch),
      "microsoft",
      new URLSearchParams({ code: "c", state: ctx.state }),
    );
    expect(location).toBe("https://crm.example.com/");
    expect(p.calls).toEqual([]);
  });

  it("the user declining consent sends them back with an error", async () => {
    const ctx = await start("google");
    const p = providerFetch({ email: "aluno@gmail.com" });
    const location = await completeCallback(
      deps(ctx, p.fetchImpl as typeof fetch),
      "google",
      new URLSearchParams({ error: "access_denied", state: ctx.state }),
    );
    expect(location).toBe("https://aluno.crm.example.com/settings/email-sync?connect_error=denied");
  });

  it("no refresh token (offline access not granted) is an error, not a half-working mailbox", async () => {
    const ctx = await start("google");
    const p = providerFetch({ email: "aluno@gmail.com", refresh: null });
    const location = await completeCallback(
      deps(ctx, p.fetchImpl as typeof fetch),
      "google",
      new URLSearchParams({ code: "c", state: ctx.state }),
    );
    expect(location).toBe(
      "https://aluno.crm.example.com/settings/email-sync?connect_error=no_refresh_token",
    );
  });
});
