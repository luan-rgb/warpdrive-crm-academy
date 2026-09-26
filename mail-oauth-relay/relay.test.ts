// Tests for the central mail OAuth relay (mail-oauth-relay/lib.mjs). The tenant and ops databases
// are real Postgres databases from the shared test harness (makeTestDb), never mocks.
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { decryptToken } from "@/features/email/crypto";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  buildAuthUrl,
  completeCallback,
  connectInit,
  encryptToken,
  ensureOpsSchema,
  isValidSlug,
  readEnvValue,
  tenantDbName,
} from "./lib.mjs";

// Same key vitest.setup.ts gives the app, so decryptToken can read what the relay wrote.
const TENANT_KEY = Buffer.alloc(32, 1).toString("base64");

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

async function dbs() {
  const ops = await makeTestDb();
  const tenant = await makeTestDb();
  open.push(ops, tenant);
  const opsQuery = (text: string, params: unknown[]) => ops.pool.query(text, params);
  await ensureOpsSchema(opsQuery);
  const r = await tenant.db.execute(
    sql`INSERT INTO users (email, name, google_sub) VALUES ('aluno@x.com','A','sub-a') RETURNING id`,
  );
  const userId = (r.rows[0] as { id: string }).id;
  return { ops, tenant, opsQuery, userId };
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
  it("only accepts tenant slugs that are safe as a database and file name", () => {
    expect(isValidSlug("estrategistacrm")).toBe(true);
    expect(isValidSlug("joao-silva")).toBe(true);
    expect(isValidSlug("../etc")).toBe(false);
    expect(isValidSlug("a b")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(tenantDbName("joao-silva")).toBe("aluno_joao_silva");
  });

  it("reads one key from an env file, ignoring comments and quotes", () => {
    const text = "# c\nFOO=1\nTOKEN_ENCRYPTION_KEY='abc='\nBAR=2\n";
    expect(readEnvValue(text, "TOKEN_ENCRYPTION_KEY")).toBe("abc=");
    expect(readEnvValue(text, "MISSING")).toBeNull();
  });

  it("encrypts in the exact envelope the app decrypts", () => {
    const packed = encryptToken(TENANT_KEY, "refresh-token");
    expect(decryptToken(packed)).toEqual({ ok: true, value: "refresh-token" });
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
  it("refuses callers without the shared relay secret", async () => {
    const { opsQuery, userId } = await dbs();
    const r = await connectInit(
      { opsQuery, cfg: CFG },
      { tenant_slug: "aluno", user_id: userId, provider: "google" },
      "wrong",
    );
    expect(r.status).toBe(401);
  });

  it("rejects an unsafe slug or unknown provider", async () => {
    const { opsQuery, userId } = await dbs();
    const bad = await connectInit(
      { opsQuery, cfg: CFG },
      { tenant_slug: "../x", user_id: userId, provider: "google" },
      CFG.relaySecret,
    );
    expect(bad.status).toBe(400);
    const badProvider = await connectInit(
      { opsQuery, cfg: CFG },
      { tenant_slug: "aluno", user_id: userId, provider: "yahoo" },
      CFG.relaySecret,
    );
    expect(badProvider.status).toBe(400);
  });

  it("records a single-use state and returns the consent URL carrying it", async () => {
    const { ops, opsQuery, userId } = await dbs();
    const r = await connectInit(
      { opsQuery, cfg: CFG },
      { tenant_slug: "aluno", user_id: userId, provider: "microsoft" },
      CFG.relaySecret,
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

describe("completeCallback", () => {
  async function start(provider: "google" | "microsoft") {
    const ctx = await dbs();
    const init = await connectInit(
      { opsQuery: ctx.opsQuery, cfg: CFG },
      { tenant_slug: "aluno", user_id: ctx.userId, provider },
      CFG.relaySecret,
    );
    const state = new URL(init.body.authUrl).searchParams.get("state") ?? "";
    return { ...ctx, state };
  }

  function deps(ctx: Awaited<ReturnType<typeof start>>, fetchImpl: typeof fetch) {
    return {
      opsQuery: ctx.opsQuery,
      tenantQuery: (slug: string) => {
        expect(slug).toBe("aluno");
        return (text: string, params: unknown[]) => ctx.tenant.pool.query(text, params);
      },
      tenantKey: () => Promise.resolve(TENANT_KEY),
      fetchImpl,
      cfg: CFG,
    };
  }

  it("Google: stores the encrypted refresh token on the student's mailbox and redirects home", async () => {
    const ctx = await start("google");
    const p = providerFetch({ email: "Aluno@Gmail.com" });
    const location = await completeCallback(
      deps(ctx, p.fetchImpl as typeof fetch),
      "google",
      new URLSearchParams({ code: "c", state: ctx.state }),
    );
    expect(location).toBe("https://aluno.crm.example.com/settings/email-sync?connected=gmail");
    const row = (
      await ctx.tenant.pool.query(
        "SELECT provider, email_address, refresh_token_enc, status FROM email_accounts WHERE user_id=$1",
        [ctx.userId],
      )
    ).rows[0] as {
      provider: string;
      email_address: string;
      refresh_token_enc: Buffer;
      status: string;
    };
    expect(row.provider).toBe("gmail");
    expect(row.email_address).toBe("aluno@gmail.com");
    expect(row.status).toBe("connected");
    expect(decryptToken(row.refresh_token_enc)).toEqual({ ok: true, value: "rt-1" });
    expect(p.calls[0]?.body).toContain(
      "redirect_uri=https%3A%2F%2Fcrm.example.com%2Fapi%2Fmail-oauth%2Fgoogle%2Fcallback",
    );
  });

  it("Microsoft: stores an outlook mailbox", async () => {
    const ctx = await start("microsoft");
    const p = providerFetch({ email: "aluno@outlook.com" });
    const location = await completeCallback(
      deps(ctx, p.fetchImpl as typeof fetch),
      "microsoft",
      new URLSearchParams({ code: "c", state: ctx.state }),
    );
    expect(location).toBe("https://aluno.crm.example.com/settings/email-sync?connected=outlook");
    const row = (
      await ctx.tenant.pool.query("SELECT provider FROM email_accounts WHERE user_id=$1", [
        ctx.userId,
      ])
    ).rows[0] as { provider: string };
    expect(row.provider).toBe("outlook");
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

  it("the user declining consent sends them back with an error, storing nothing", async () => {
    const ctx = await start("google");
    const p = providerFetch({ email: "aluno@gmail.com" });
    const location = await completeCallback(
      deps(ctx, p.fetchImpl as typeof fetch),
      "google",
      new URLSearchParams({ error: "access_denied", state: ctx.state }),
    );
    expect(location).toBe("https://aluno.crm.example.com/settings/email-sync?connect_error=denied");
    const n = (await ctx.tenant.pool.query("SELECT count(*)::int AS n FROM email_accounts"))
      .rows[0];
    expect(n).toEqual({ n: 0 });
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

  it("an address already connected by another user of the tenant is reported", async () => {
    const ctx = await start("google");
    const other = await ctx.tenant.db.execute(
      sql`INSERT INTO users (email, name, google_sub) VALUES ('b@x.com','B','sub-b') RETURNING id`,
    );
    await ctx.tenant.pool.query(
      "INSERT INTO email_accounts (user_id, email_address, status) VALUES ($1, 'aluno@gmail.com', 'connected')",
      [(other.rows[0] as { id: string }).id],
    );
    const p = providerFetch({ email: "aluno@gmail.com" });
    const location = await completeCallback(
      deps(ctx, p.fetchImpl as typeof fetch),
      "google",
      new URLSearchParams({ code: "c", state: ctx.state }),
    );
    expect(location).toBe("https://aluno.crm.example.com/settings/email-sync?connect_error=taken");
  });
});
