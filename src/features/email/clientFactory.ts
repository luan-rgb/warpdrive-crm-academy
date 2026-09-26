import { sql } from "drizzle-orm";
import type { EmailProvider } from "@/constants/email";
import { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { decryptToken } from "./crypto";
import type { GmailClient } from "./gmailClient";
import { type ImapConfig, imapSettingsSchema } from "./imapSettings";
import { ensureAccessToken, type RefreshFn } from "./tokens";

// Every mailbox, whatever its provider, is driven through the one GmailClient interface, so sync,
// send, trash and attachments stay provider-agnostic. This is the single place that decides which
// implementation backs an account.
export interface ClientFactoryDeps {
  refreshFor: (provider: "gmail" | "outlook", signal: AbortSignal) => RefreshFn;
  gmail: (accessToken: string) => GmailClient;
  outlook: (accessToken: string) => GmailClient;
  imap: (config: ImapConfig) => GmailClient;
}

interface AccountRow {
  provider: EmailProvider;
  imap_settings: unknown;
  imap_password_enc: Buffer | null;
}

export async function loadProvider(db: Db, accountId: string): Promise<EmailProvider | null> {
  const rows = await db.execute(sql`SELECT provider FROM email_accounts WHERE id=${accountId}`);
  const row = rows.rows[0] as { provider: EmailProvider } | undefined;
  return row?.provider ?? null;
}

export async function resolveMailClient(
  db: Db,
  accountId: string,
  signal: AbortSignal,
  deps: ClientFactoryDeps,
): Promise<Result<GmailClient, AppError>> {
  signal.throwIfAborted();
  const rows = await db.execute(
    sql`SELECT provider, imap_settings, imap_password_enc FROM email_accounts WHERE id=${accountId}`,
  );
  signal.throwIfAborted();
  const row = rows.rows[0] as AccountRow | undefined;
  if (row === undefined) {
    return err(new AppError("E_MAIL_002", "email account not found", { accountId }));
  }

  if (row.provider === "imap") return buildImap(row, accountId, deps);

  const provider = row.provider;
  const token = await ensureAccessToken(db, {
    accountId,
    deps: { refresh: deps.refreshFor(provider, signal) },
  });
  if (!token.ok) return token;
  return ok(provider === "gmail" ? deps.gmail(token.value.token) : deps.outlook(token.value.token));
}

function buildImap(
  row: AccountRow,
  accountId: string,
  deps: ClientFactoryDeps,
): Result<GmailClient, AppError> {
  const settings = imapSettingsSchema.safeParse(row.imap_settings);
  if (row.imap_password_enc === null || !settings.success) {
    return err(new AppError("E_MAIL_001", "imap account has no stored credentials", { accountId }));
  }
  const password = decryptToken(row.imap_password_enc);
  if (!password.ok) return password;
  return ok(deps.imap({ ...settings.data, password: password.value }));
}
