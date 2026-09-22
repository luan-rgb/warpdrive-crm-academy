import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { citext } from "./identity";

// Passwordless login for deploys where Google OAuth isn't available (e.g. one Google OAuth
// client can't register a redirect URI per multi-tenant subdomain, and Workspace-only sign-in
// blocks personal Gmail). See src/features/auth/magicLink.ts.
export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: citext("email").notNull(),
    // sha256 of the token embedded in the emailed link, same rationale as sessions.tokenHash:
    // the raw value is a bearer credential, so only its digest is ever stored.
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("magic_link_tokens_email_idx").on(t.email)],
);
