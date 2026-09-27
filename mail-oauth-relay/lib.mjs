// Pure logic of the mail OAuth relay (see server.mjs for why the relay exists). Everything that
// touches the outside world is passed in (database query function, fetch), so relay.test.ts runs
// it against a real Postgres database.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// Keep in sync with src/constants/mailOAuth.ts (the tenant side refreshes with the same scopes).
const GOOGLE = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  identityUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  scopes: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  storedAs: "gmail",
};
const MICROSOFT = {
  authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  identityUrl: "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName",
  scopes: [
    "offline_access",
    "openid",
    "email",
    "https://graph.microsoft.com/User.Read",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.Send",
  ],
  storedAs: "outlook",
};
const PROVIDERS = { google: GOOGLE, microsoft: MICROSOFT };

const STATE_TTL = "15 minutes";
// How long a finished consent waits for the tenant app to claim it.
const RESULT_TTL = "10 minutes";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function relayConfigFromEnv(env) {
  return {
    baseDomain: env.BASE_DOMAIN ?? "",
    relaySecret: env.MAIL_OAUTH_RELAY_SECRET ?? "",
    google: {
      clientId: env.GMAIL_OAUTH_CLIENT_ID ?? "",
      clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET ?? "",
    },
    microsoft: {
      clientId: env.MICROSOFT_OAUTH_CLIENT_ID ?? "",
      clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET ?? "",
    },
  };
}

// A slug becomes a database name and an env file path, so only DNS-label characters get through.
export function isValidSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug);
}

export function redirectUri(cfg, provider) {
  return `https://${cfg.baseDomain}/api/mail-oauth/${provider}/callback`;
}

export function buildAuthUrl(cfg, provider, state) {
  const p = PROVIDERS[provider];
  const u = new URL(p.authUrl);
  u.searchParams.set("client_id", cfg[provider].clientId);
  u.searchParams.set("redirect_uri", redirectUri(cfg, provider));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", p.scopes.join(" "));
  u.searchParams.set("state", state);
  if (provider === "google") {
    // offline + consent: Google only returns a refresh token on a fresh consent.
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("include_granted_scopes", "true");
  } else {
    u.searchParams.set("response_mode", "query");
    u.searchParams.set("prompt", "select_account");
  }
  return u.toString();
}

// Tenants never hold the relay's master secret, only HMAC(master, slug): a leaked tenant env can
// then speak for that tenant alone. scripts/provision-tenant.sh derives the same value.
export function tenantSecret(masterSecret, slug) {
  return createHmac("sha256", masterSecret).update(slug).digest("hex");
}

// A finished consent waits in warpdrive_ops until the tenant claims it; the refresh token is kept
// sealed (AES-256-GCM, key derived from the master secret) so the ops database never holds it in
// plain text.
function sealKey(cfg) {
  return createHash("sha256").update(`mail-oauth-relay:at-rest:${cfg.relaySecret}`).digest();
}

function seal(cfg, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(cfg), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function unseal(cfg, packed) {
  const decipher = createDecipheriv("aes-256-gcm", sealKey(cfg), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
}

function secretMatches(masterSecret, slug, given) {
  if (typeof given !== "string" || masterSecret.length === 0 || !isValidSlug(slug)) return false;
  const expected = tenantSecret(masterSecret, slug);
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function ensureOpsSchema(opsQuery) {
  await opsQuery(
    `CREATE TABLE IF NOT EXISTS mail_oauth_requests (
       state text PRIMARY KEY,
       tenant_slug text NOT NULL,
       user_id uuid NOT NULL,
       provider text NOT NULL,
       expires_at timestamptz NOT NULL,
       consumed_at timestamptz
     )`,
    [],
  );
  // Columns for the claim step (added after the first deploy, hence IF NOT EXISTS).
  for (const column of [
    "ticket text UNIQUE",
    "result_email text",
    "result_sealed bytea",
    "completed_at timestamptz",
    "claimed_at timestamptz",
  ]) {
    await opsQuery(`ALTER TABLE mail_oauth_requests ADD COLUMN IF NOT EXISTS ${column}`, []);
  }
}

// POST /connect-init, called server-to-server by a tenant app (never the browser). The tenant's
// derived secret stops anyone who can reach the relay from minting states for a tenant.
export async function connectInit({ opsQuery, cfg }, body, headerSecret) {
  const { tenant_slug: slug, user_id: userId, provider } = body ?? {};
  if (!isValidSlug(slug)) return { status: 400, body: { error: "invalid_request" } };
  if (!secretMatches(cfg.relaySecret, slug, headerSecret))
    return { status: 401, body: { error: "unauthorized" } };
  if (typeof userId !== "string" || !UUID_RE.test(userId) || !(provider in PROVIDERS)) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  if (cfg[provider].clientId === "")
    return { status: 503, body: { error: "provider_not_configured" } };

  const state = randomBytes(32).toString("base64url");
  await opsQuery("DELETE FROM mail_oauth_requests WHERE expires_at < now() - interval '1 day'", []);
  await opsQuery(
    `INSERT INTO mail_oauth_requests (state, tenant_slug, user_id, provider, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '${STATE_TTL}')`,
    [state, slug, userId, provider],
  );
  return { status: 200, body: { authUrl: buildAuthUrl(cfg, provider, state) } };
}

async function exchangeCode(fetchImpl, cfg, provider, code) {
  const p = PROVIDERS[provider];
  const form = new URLSearchParams({
    client_id: cfg[provider].clientId,
    client_secret: cfg[provider].clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(cfg, provider),
  });
  if (provider === "microsoft") form.set("scope", p.scopes.join(" "));
  const res = await fetchImpl(p.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return await res.json();
}

async function fetchEmail(fetchImpl, provider, accessToken) {
  const res = await fetchImpl(PROVIDERS[provider].identityUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const body = await res.json();
  const email =
    provider === "google"
      ? body.email_verified === true
        ? body.email
        : null
      : (body.mail ?? body.userPrincipalName);
  return typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : null;
}

// GET /{provider}/callback. Returns the URL to redirect the browser to; never throws for an
// operational failure (the student always lands back on a page that says what happened).
//
// The relay does NOT bind the mailbox itself: whoever opens a consent link may not be the CRM user
// who asked for it (a link forwarded to someone else would otherwise attach THEIR mailbox to the
// sender's account). It parks the result behind a single-use ticket and sends the browser to the
// tenant, which only claims it for the logged-in user who started the connection.
export async function completeCallback(deps, provider, query) {
  const { opsQuery, fetchImpl, cfg } = deps;
  const home = `https://${cfg.baseDomain}/`;
  const state = query.get("state");
  if (!(provider in PROVIDERS) || state === null) return home;

  // Consume atomically: the state works once, before its expiry, for the provider it was minted for.
  const { rows } = await opsQuery(
    `UPDATE mail_oauth_requests SET consumed_at = now()
     WHERE state = $1 AND provider = $2 AND consumed_at IS NULL AND expires_at > now()
     RETURNING tenant_slug`,
    [state, provider],
  );
  const request = rows[0];
  if (request === undefined) return home;
  const tenantHome = `https://${request.tenant_slug}.${cfg.baseDomain}`;
  const back = (qs) => `${tenantHome}/settings/email-sync?${qs}`;

  const code = query.get("code");
  if (code === null) return back("connect_error=denied");

  const tokens = await exchangeCode(fetchImpl, cfg, provider, code);
  if (tokens === null || typeof tokens.access_token !== "string")
    return back("connect_error=exchange");
  if (typeof tokens.refresh_token !== "string") return back("connect_error=no_refresh_token");

  const email = await fetchEmail(fetchImpl, provider, tokens.access_token);
  if (email === null) return back("connect_error=identity");

  const ticket = randomBytes(32).toString("base64url");
  await opsQuery(
    `UPDATE mail_oauth_requests
     SET ticket = $2, result_email = $3, result_sealed = $4, completed_at = now()
     WHERE state = $1`,
    [state, ticket, email, seal(cfg, tokens.refresh_token)],
  );
  return `${tenantHome}/api/mail-oauth/complete?ticket=${ticket}`;
}

// POST /claim {tenant_slug, user_id, ticket}, server-to-server from the tenant app. Succeeds once,
// only for the tenant and user the connection was started for, within RESULT_TTL.
export async function claimResult({ opsQuery, cfg }, body, headerSecret) {
  const { tenant_slug: slug, user_id: userId, ticket } = body ?? {};
  if (!isValidSlug(slug)) return { status: 400, body: { error: "invalid_request" } };
  if (!secretMatches(cfg.relaySecret, slug, headerSecret))
    return { status: 401, body: { error: "unauthorized" } };
  if (typeof userId !== "string" || !UUID_RE.test(userId) || typeof ticket !== "string") {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const { rows } = await opsQuery(
    `UPDATE mail_oauth_requests SET claimed_at = now()
     WHERE ticket = $1 AND tenant_slug = $2 AND user_id = $3 AND claimed_at IS NULL
       AND completed_at > now() - interval '${RESULT_TTL}'
     RETURNING provider, result_email, result_sealed`,
    [ticket, slug, userId],
  );
  const row = rows[0];
  if (row === undefined) return { status: 404, body: { error: "not_found" } };
  // The sealed token is only needed once.
  await opsQuery("UPDATE mail_oauth_requests SET result_sealed = NULL WHERE ticket = $1", [ticket]);
  const p = PROVIDERS[row.provider];
  return {
    status: 200,
    body: {
      provider: p.storedAs,
      email: row.result_email,
      refreshToken: unseal(cfg, row.result_sealed),
      scopes: p.scopes,
    },
  };
}
