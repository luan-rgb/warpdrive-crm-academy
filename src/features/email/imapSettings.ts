import { z } from "zod";

// Non-secret connection settings for an IMAP/SMTP mailbox, stored as email_accounts.imap_settings.
// Validated once when read back from the jsonb column (a file/DB read is a boundary too).
const endpointSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  // true = implicit TLS (993/465); false = STARTTLS upgrade (143/587). Plaintext is never offered.
  secure: z.boolean(),
});

export const imapSettingsSchema = z.object({
  username: z.string().trim().min(1).max(320),
  imap: endpointSchema,
  smtp: endpointSchema,
});

export type ImapSettings = z.infer<typeof imapSettingsSchema>;

// Settings plus the decrypted password: what the IMAP client needs to open a session. Only ever
// held in memory for the lifetime of one client.
export interface ImapConfig extends ImapSettings {
  password: string;
}

// What the "Outro provedor (IMAP/SMTP)" form submits. The login defaults to the address when the
// provider uses the full address as username, which is the common case.
export const imapConnectInputSchema = imapSettingsSchema.extend({
  emailAddress: z.string().trim().email().max(320),
  password: z.string().min(1).max(1024),
});

export type ImapConnectInput = z.infer<typeof imapConnectInputSchema>;
