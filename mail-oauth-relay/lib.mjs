// Pure logic of the mail OAuth relay (see server.mjs for why the relay exists). Everything that
// touches the outside world is passed in (database query functions, fetch, the tenant's
// encryption key), so relay.test.ts runs it against real Postgres databases.
import { createCipheriv, randomBytes, timingSafeEqual } from "node:crypto";

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

export function tenantDbName(slug) {
  return `aluno_${slug.replaceAll("-", "_")}`;
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

// Same AES-256-GCM envelope as src/features/email/crypto.ts: iv(12) || tag(16) || ciphertext.
export function encryptToken(keyBase64, plaintext) {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("tenant TOKEN_ENCRYPTION_KEY is not 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function readEnvValue(text, name) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#") || !line.startsWith(`${name}=`)) continue;
    return line.slice(name.length + 1).replace(/^(['"])(.*)\1$/, "$2");
  }
  return null;
}

function secretMatches(expected, given) {
  if (typeof given !== "string" || expected.length === 0) return false;
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
       created_at timestamptz NOT NULL DEFAULT now(),
       expires_at timestamptz NOT NULL,
       consumed_at timestamptz
     )`,
    [],
  );
}

// POST /connect-init, called server-to-server by a tenant app (never the browser). The shared
// secret stops anyone who can reach the relay from minting states that would bind THEIR mailbox
// to someone else's CRM user.
export async function connectInit({ opsQuery, cfg }, body, headerSecret) {
  if (!secretMatches(cfg.relaySecret, headerSecret))
    return { status: 401, body: { error: "unauthorized" } };
  const { tenant_slug: slug, user_id: userId, provider } = body ?? {};
  if (
    !isValidSlug(slug) ||
    typeof userId !== "string" ||
    !UUID_RE.test(userId) ||
    !(provider in PROVIDERS)
  ) {
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
export async function completeCallback(deps, provider, query) {
  const { opsQuery, tenantQuery, tenantKey, fetchImpl, cfg } = deps;
  const home = `https://${cfg.baseDomain}/`;
  const state = query.get("state");
  if (!(provider in PROVIDERS) || state === null) return home;

  // Consume atomically: the state works once, before its expiry, for the provider it was minted for.
  const { rows } = await opsQuery(
    `UPDATE mail_oauth_requests SET consumed_at = now()
     WHERE state = $1 AND provider = $2 AND consumed_at IS NULL AND expires_at > now()
     RETURNING tenant_slug, user_id`,
    [state, provider],
  );
  const request = rows[0];
  if (request === undefined) return home;
  const back = (qs) => `https://${request.tenant_slug}.${cfg.baseDomain}/settings/email-sync?${qs}`;

  const code = query.get("code");
  if (code === null) return back("connect_error=denied");

  const tokens = await exchangeCode(fetchImpl, cfg, provider, code);
  if (tokens === null || typeof tokens.access_token !== "string")
    return back("connect_error=exchange");
  if (typeof tokens.refresh_token !== "string") return back("connect_error=no_refresh_token");

  const email = await fetchEmail(fetchImpl, provider, tokens.access_token);
  if (email === null) return back("connect_error=identity");

  const key = await tenantKey(request.tenant_slug);
  if (key === null) return back("connect_error=tenant");
  const enc = encryptToken(key, tokens.refresh_token);
  const p = PROVIDERS[provider];
  try {
    await tenantQuery(request.tenant_slug)(
      `INSERT INTO email_accounts (user_id, email_address, provider, refresh_token_enc, scopes, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'connected')
       ON CONFLICT (user_id) DO UPDATE SET
         email_address = EXCLUDED.email_address,
         provider = EXCLUDED.provider,
         refresh_token_enc = EXCLUDED.refresh_token_enc,
         scopes = EXCLUDED.scopes,
         imap_settings = NULL,
         imap_password_enc = NULL,
         last_history_id = NULL,
         status = 'connected',
         last_error_id = NULL,
         updated_at = now()`,
      [request.user_id, email, p.storedAs, enc, JSON.stringify(p.scopes)],
    );
  } catch (e) {
    // email_address is unique per tenant: the address is already connected by another user.
    if (e?.code === "23505") return back("connect_error=taken");
    throw e;
  }
  return back(`connected=${p.storedAs}`);
}
