import { readFileSync } from "node:fs";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";

// Secret vars may be supplied as <VAR>_FILE pointing at a Docker secret file.
const SECRET_FILE_VARS = [
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GMAIL_OAUTH_CLIENT_SECRET",
  "MICROSOFT_OAUTH_CLIENT_SECRET",
  "MAIL_OAUTH_RELAY_SECRET",
  "WS_TICKET_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "MINIO_SECRET_KEY",
  "DATABASE_URL",
  "OAUTH_SIGNING_KEY",
] as const;

function resolveFileVars(raw: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...raw };
  for (const name of SECRET_FILE_VARS) {
    const filePath = raw[`${name}_FILE`];
    if (filePath != null && filePath.length > 0) {
      out[name] = readFileSync(filePath, "utf8").trim();
    }
  }
  return out;
}

const boolFromString = z.enum(["true", "false"]).transform((v) => v === "true");

const base = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Optional (empty disables Google sign-in, see auth/google.ts): a deploy with no Google
  // Workspace, or one where Google's redirect_uri can't be registered per subdomain (multi-tenant
  // hosting, one subdomain per student), uses magic-link sign-in below instead.
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(""),
  GOOGLE_WORKSPACE_DOMAIN: z.string().default(""),
  // Optional (empty disables magic-link sign-in, see auth/magicLink.ts and magicLinkEmail.ts).
  RESEND_API_KEY: z.string().default(""),
  MAGIC_LINK_FROM_EMAIL: z.string().email().or(z.literal("")).default(""),
  // Free direct mailbox connect (src/features/email/clientFactory.ts). One Google OAuth client
  // and one Microsoft Entra app serve every tenant: Google and Microsoft only accept a fixed
  // redirect_uri, so the OAuth dance runs in the central mail-oauth-relay service and tenants
  // only need the ids/secrets here to refresh tokens. Empty disables that provider's button.
  // The Gmail client is kept apart from GOOGLE_OAUTH_* (sign-in) on purpose: sign-in is
  // Workspace-domain-restricted, a student's mailbox is not.
  GMAIL_OAUTH_CLIENT_ID: z.string().default(""),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().default(""),
  MICROSOFT_OAUTH_CLIENT_ID: z.string().default(""),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().default(""),
  // Internal URL of the relay (shared Docker network) and the secret its connect-init requires.
  MAIL_OAUTH_RELAY_URL: z.string().url().default("http://shared-mail-oauth-relay:8081"),
  MAIL_OAUTH_RELAY_SECRET: z.string().default(""),
  BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  WS_TICKET_SECRET: z.string().min(32),
  WS_PUBLIC_URL: z.string().min(1),
  // Full URL, not a bare hostname: buildMinioClient does new URL(MINIO_ENDPOINT), and the
  // browser POSTs uploads directly to the presigned host, so it must be publicly reachable
  // (e.g. https://s3.example.com), never an internal-only compose alias like "minio".
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1).default("warpdrive"),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(26_214_400),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be base64 of exactly 32 bytes"),
  MCP_ENABLED: boolFromString.default(true),
  OAUTH_SIGNING_KEY: z.string().default(""),
  // RFC 7591 dynamic client registration. Open by default because it is what lets an MCP client
  // self-onboard with no admin step, and closing it by default would break every existing deploy
  // on upgrade. It is a knob because an open endpoint lets any stranger mint a client whose name
  // the consent screen then shows to a user, which is the setup for consent phishing: a deploy
  // that has already connected the clients it needs can set "disabled" and shut the door. An
  // enum rather than a boolean so a typo fails at boot instead of silently reading as "open".
  OAUTH_REGISTRATION: z.enum(["open", "disabled"]).default("open"),
  BASE_CURRENCY: z.string().length(3).default("BRL"),
  SEED_ADMIN_EMAIL: z.string().email().or(z.literal("")).default(""),
  ALLOW_FIRST_LOGIN_ADMIN: boolFromString.default(false),
  // Optional build-time stamp of the running version (e.g. a release tag). Empty when unstamped;
  // the release feature then falls back to package.json, then "dev". See resolveVersion.
  APP_VERSION: z.string().default(""),
  // Client PostHog config is passed to the browser via the server layout (props), not
  // NEXT_PUBLIC vars, so this stays the single env boundary. Empty key disables telemetry.
  POSTHOG_KEY: z.string().default(""),
  POSTHOG_HOST: z.string().default(""),
  DISABLE_TELEMETRY: boolFromString.default(false),
  // Console.warn/error forwarding is off by default (widens the event surface); opt in per deploy.
  TELEMETRY_CONSOLE_FORWARDING: boolFromString.default(false),
  // Git SHA of the running build, for regression attribution alongside APP_VERSION.
  APP_COMMIT: z.string().default(""),
  // Kill switch for the GitHub update-check banner. A hosted/managed deployment sets this true;
  // OSS self-hosters leave it false to get the banner.
  DISABLE_UPDATE_CHECK: boolFromString.default(false),
});

// Production guardrails for the first-run bootstrap (ops spec E6).
const schema = base.superRefine((v, ctx) => {
  if (v.MCP_ENABLED && Buffer.from(v.OAUTH_SIGNING_KEY, "base64").length !== 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OAUTH_SIGNING_KEY"],
      message: "OAUTH_SIGNING_KEY (base64 32 bytes) is required when MCP_ENABLED",
    });
  }
  if (v.NODE_ENV === "production") {
    if (v.ALLOW_FIRST_LOGIN_ADMIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ALLOW_FIRST_LOGIN_ADMIN"],
        message: "ALLOW_FIRST_LOGIN_ADMIN must be false in production",
      });
    }
    if (v.SEED_ADMIN_EMAIL === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SEED_ADMIN_EMAIL"],
        message: "SEED_ADMIN_EMAIL is required in production",
      });
    }
    const googleConfigured =
      v.GOOGLE_OAUTH_CLIENT_ID !== "" &&
      v.GOOGLE_OAUTH_CLIENT_SECRET !== "" &&
      v.GOOGLE_WORKSPACE_DOMAIN !== "";
    const magicLinkConfigured = v.RESEND_API_KEY !== "" && v.MAGIC_LINK_FROM_EMAIL !== "";
    if (!googleConfigured && !magicLinkConfigured) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_OAUTH_CLIENT_ID"],
        message:
          "production needs a way to sign in: set GOOGLE_OAUTH_CLIENT_ID/SECRET/WORKSPACE_DOMAIN, or RESEND_API_KEY/MAGIC_LINK_FROM_EMAIL",
      });
    }
  }
});

// Named export of the full validated schema (with production guardrails) so
// boundary tests can parse a candidate env map directly.
export const envSchema = schema;

export type Env = z.infer<typeof base>;

// Pure, testable: validates a given source map without touching the global env.
export function parseEnv(raw: NodeJS.ProcessEnv): Result<Env, string> {
  const resolved = resolveFileVars(raw);
  const parsed = schema.safeParse(resolved);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return ok(parsed.data);
}

function loadOrThrow(): Env {
  const result = parseEnv(process.env);
  if (!result.ok) {
    // Fail fast at import time so misconfiguration is a boot error, not a first-use error.
    throw new Error(`Invalid environment: ${result.error}`);
  }
  return result.value;
}

export const env: Env = loadOrThrow();
