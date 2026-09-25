// Central relay for Nylas's Gmail/Outlook connect flow across every CRM Academy tenant.
// See docs/superpowers/specs/2026-09-25-nylas-email-integration-design.md.
//
// Why this exists as its own service (not inside any tenant's app): Nylas's hosted auth needs
// ONE fixed redirect_uri for the whole application, never a per-tenant subdomain (that's the
// exact limitation this design works around), so something outside any single tenant has to own
// that one URL and know how to route a completed connection back to the right tenant's own
// database. Runs as a `docker-compose.shared.yml` service, alongside Postgres/MinIO/Caddy, with
// admin credentials for the one shared Postgres instance every tenant database lives in (the
// same cross-database access scripts/hotmart-lifecycle.sh already uses for its own purposes).
//
// Two routes:
//   POST /connect-init  { tenant_slug, user_id, provider } -> { authUrl }
//     Called by a tenant's own Next.js server (never the browser directly) when a user clicks
//     "Connect Gmail/Outlook". Mints a single-use state, records it, returns the URL to redirect
//     the browser to.
//   GET  /callback?code=...&state=...
//     Nylas redirects the browser here after the user approves. Exchanges code for a grant_id,
//     writes it into the right tenant's own email_accounts row, and redirects the browser back
//     to that tenant's settings page.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import pg from "pg";

const { Pool } = pg;

const PORT = Number(process.env.PORT ?? 8081);
const NYLAS_API_KEY = process.env.NYLAS_API_KEY ?? "";
const NYLAS_CLIENT_ID = process.env.NYLAS_CLIENT_ID ?? "";
const NYLAS_REGION = process.env.NYLAS_REGION ?? "us";
const BASE_DOMAIN = process.env.BASE_DOMAIN ?? "";
const REDIRECT_URI = `https://${BASE_DOMAIN}/api/nylas/callback`;
const NYLAS_API_BASE =
  NYLAS_REGION === "eu" ? "https://api.eu.nylas.com" : "https://api.us.nylas.com";

const opsPool = new Pool({
  host: "shared-postgres",
  user: process.env.SHARED_POSTGRES_ADMIN_USER,
  password: process.env.SHARED_POSTGRES_ADMIN_PASSWORD,
  database: "warpdrive_ops",
});

// Separate pool per tenant database (all on the same shared-postgres instance, different
// database name), cached: connect-init and callback for the same tenant reuse one pool instead
// of opening a fresh connection per request.
const tenantPools = new Map();
function tenantPool(slug) {
  const dbName = `aluno_${slug.replaceAll("-", "_")}`;
  let pool = tenantPools.get(dbName);
  if (pool === undefined) {
    pool = new Pool({
      host: "shared-postgres",
      user: process.env.SHARED_POSTGRES_ADMIN_USER,
      password: process.env.SHARED_POSTGRES_ADMIN_PASSWORD,
      database: dbName,
      max: 2,
    });
    tenantPools.set(dbName, pool);
  }
  return pool;
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data.length > 0 ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function handleConnectInit(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: "invalid_json" });
  }
  const { tenant_slug: tenantSlug, user_id: userId, provider } = body;
  if (
    typeof tenantSlug !== "string" ||
    tenantSlug.length === 0 ||
    typeof userId !== "string" ||
    userId.length === 0 ||
    (provider !== "google" && provider !== "microsoft")
  ) {
    return json(res, 400, { error: "invalid_request" });
  }

  const state = randomBytes(32).toString("base64url");
  await opsPool.query(
    `INSERT INTO nylas_connect_requests (state, tenant_slug, user_id, provider, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '15 minutes')`,
    [state, tenantSlug, userId, provider],
  );

  const authUrl = new URL(`${NYLAS_API_BASE}/v3/connect/auth`);
  authUrl.searchParams.set("client_id", NYLAS_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("provider", provider);
  authUrl.searchParams.set("state", state);
  return json(res, 200, { authUrl: authUrl.toString() });
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

async function handleCallback(req, res, query) {
  const code = query.get("code");
  const state = query.get("state");
  if (code === null || state === null) {
    return redirect(res, `https://${BASE_DOMAIN}/`); // no tenant known yet: nothing better to do
  }

  const { rows } = await opsPool.query(
    `SELECT tenant_slug, user_id FROM nylas_connect_requests
     WHERE state = $1 AND consumed_at IS NULL AND expires_at > now()`,
    [state],
  );
  const request = rows[0];
  if (request === undefined) {
    return redirect(res, `https://${BASE_DOMAIN}/`);
  }
  const { tenant_slug: tenantSlug, user_id: userId } = request;

  const tokenRes = await fetch(`${NYLAS_API_BASE}/v3/connect/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: NYLAS_CLIENT_ID,
      client_secret: NYLAS_API_KEY,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!tokenRes.ok) {
    console.error("[nylas-relay] token exchange failed:", tokenRes.status, await tokenRes.text());
    return redirect(res, `https://${tenantSlug}.${BASE_DOMAIN}/settings/email?connected=0`);
  }
  const token = await tokenRes.json();
  const grantId = token.grant_id;

  const tenant = tenantPool(tenantSlug);
  await tenant.query(
    `INSERT INTO email_accounts (user_id, email_address, nylas_grant_id, status)
     VALUES ($1, $2, $3, 'connected')
     ON CONFLICT (user_id) DO UPDATE SET nylas_grant_id = $3, status = 'connected'`,
    [userId, token.email ?? `${userId}@unknown`, grantId],
  );

  await opsPool.query(
    `UPDATE nylas_connect_requests SET consumed_at = now(), grant_id = $2 WHERE state = $1`,
    [state, grantId],
  );

  return redirect(res, `https://${tenantSlug}.${BASE_DOMAIN}/settings/email?connected=1`);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://internal");
    if (req.method === "POST" && url.pathname === "/connect-init") {
      return await handleConnectInit(req, res);
    }
    if (req.method === "GET" && url.pathname === "/callback") {
      return await handleCallback(req, res, url.searchParams);
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: "not_found" });
  } catch (e) {
    console.error("[nylas-relay] unhandled error:", e);
    json(res, 500, { error: "internal_error" });
  }
});

server.listen(PORT, () => {
  console.log(`nylas-relay listening on :${PORT}, redirect_uri=${REDIRECT_URI}`);
});
