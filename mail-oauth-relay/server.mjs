// Central relay for the free, direct Gmail and Outlook mailbox connections of every CRM Academy
// tenant (replaces the paid Nylas relay).
//
// Why a separate service: Google and Microsoft only accept a fixed, pre-registered redirect_uri
// per OAuth client, and every student has their own subdomain. So one service outside any tenant
// owns the single callback URL for each provider. It never writes to a tenant: a finished consent
// waits here behind a single-use ticket, and the tenant app claims it only for the logged-in user
// who started the connection, then encrypts and stores the token with its own key.
//
// Routes:
//   POST /connect-init   {tenant_slug, user_id, provider} + x-relay-secret -> {authUrl}
//   POST /claim          {tenant_slug, user_id, ticket} + x-relay-secret -> mailbox + token
//                        both server-to-server from a tenant app only (not exposed by nginx);
//                        x-relay-secret is HMAC(master secret, tenant slug).
//   GET  /google/callback, /microsoft/callback   the public redirect_uri targets.
//   GET  /health
import { createServer } from "node:http";
import pg from "pg";
import {
  claimResult,
  completeCallback,
  connectInit,
  ensureOpsSchema,
  relayConfigFromEnv,
} from "./lib.mjs";

const { Pool } = pg;
const PORT = Number(process.env.PORT ?? 8081);
const cfg = relayConfigFromEnv(process.env);

const pgBase = {
  host: process.env.SHARED_POSTGRES_HOST ?? "shared-postgres",
  user: process.env.SHARED_POSTGRES_ADMIN_USER,
  password: process.env.SHARED_POSTGRES_ADMIN_PASSWORD,
};
const opsPool = new Pool({ ...pgBase, database: "warpdrive_ops", max: 2 });
const opsQuery = (text, params) => opsPool.query(text, params);

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(data.length > 0 ? JSON.parse(data) : {});
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    req.on("error", reject);
  });
}

const CALLBACK = /^\/(google|microsoft)\/callback$/;

async function handle(req, res) {
  try {
    const url = new URL(req.url ?? "/", "http://internal");
    if (req.method === "POST" && url.pathname === "/connect-init") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return json(res, 400, { error: "invalid_json" });
      }
      const r = await connectInit({ opsQuery, cfg }, body, req.headers["x-relay-secret"]);
      return json(res, r.status, r.body);
    }
    if (req.method === "POST" && url.pathname === "/claim") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return json(res, 400, { error: "invalid_json" });
      }
      const r = await claimResult({ opsQuery, cfg }, body, req.headers["x-relay-secret"]);
      return json(res, r.status, r.body);
    }
    const cb = req.method === "GET" ? CALLBACK.exec(url.pathname) : null;
    if (cb !== null) {
      const location = await completeCallback(
        { opsQuery, fetchImpl: fetch, cfg },
        cb[1],
        url.searchParams,
      );
      res.writeHead(302, { location });
      return res.end();
    }
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
    json(res, 404, { error: "not_found" });
  } catch (e) {
    // Never log request query strings: they carry OAuth codes.
    console.error("[mail-oauth-relay] unhandled error:", e instanceof Error ? e.message : e);
    json(res, 500, { error: "internal_error" });
  }
}

const server = createServer((req, res) => {
  void handle(req, res);
});

// warpdrive_ops holds relay bookkeeping only (never tenant data). Created on first boot so a fresh
// shared stack needs no manual SQL.
async function ensureOpsDatabase() {
  const admin = new Pool({ ...pgBase, database: "postgres", max: 1 });
  try {
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'warpdrive_ops'");
    if (rows.length === 0) await admin.query("CREATE DATABASE warpdrive_ops");
  } finally {
    await admin.end();
  }
}

await ensureOpsDatabase();
await ensureOpsSchema(opsQuery);
server.listen(PORT, () => {
  console.warn(
    `mail-oauth-relay listening on :${PORT} for https://${cfg.baseDomain}/api/mail-oauth/*`,
  );
});
