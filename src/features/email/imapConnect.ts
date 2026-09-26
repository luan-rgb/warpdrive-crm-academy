import { sql } from "drizzle-orm";
import { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { encryptToken } from "./crypto";
import { type ImapConfig, type ImapSettings, imapConnectInputSchema } from "./imapSettings";
import { PG_UNIQUE_VIOLATION, pgErrorCode } from "./pgErrors";

// Bind (or re-bind) the user's one mailbox to an IMAP/SMTP account. Same one-mailbox-per-user
// upsert as the OAuth path; switching provider wipes the other provider's credential and the Gmail
// history cursor so nothing stale is ever used against the new server. Callers verify the login
// (verifyImapSmtp) first; this only persists.
export async function bindImapAccount(
  db: Db,
  args: { userId: string; emailAddress: string; settings: ImapSettings; password: string },
): Promise<Result<{ accountId: string }, AppError>> {
  const email = args.emailAddress.trim().toLowerCase();
  const enc = encryptToken(args.password);
  try {
    const res = await db.execute(sql`
      INSERT INTO email_accounts (user_id, email_address, provider, imap_settings, imap_password_enc, status)
      VALUES (${args.userId}, ${email}, 'imap', ${JSON.stringify(args.settings)}::jsonb, ${enc}, 'connected')
      ON CONFLICT (user_id) DO UPDATE SET
        email_address = EXCLUDED.email_address,
        provider = 'imap',
        imap_settings = EXCLUDED.imap_settings,
        imap_password_enc = EXCLUDED.imap_password_enc,
        refresh_token_enc = NULL,
        last_history_id = NULL,
        status = 'connected',
        last_error_id = NULL,
        updated_at = now()
      RETURNING id
    `);
    const row = res.rows[0] as { id: string } | undefined;
    if (row === undefined)
      return err(new AppError("E_DB_002", "imap account upsert returned no row", {}));
    return ok({ accountId: row.id });
  } catch (e) {
    // ON CONFLICT targets user_id, so a unique violation here is the separate email_address key:
    // the address is already connected by a different user, whose row stays untouched.
    if (pgErrorCode(e) === PG_UNIQUE_VIOLATION) {
      return err(new AppError("E_GMAIL_006", "mailbox address already bound to another user", {}));
    }
    throw e;
  }
}

export interface ConnectImapDeps {
  verify: (config: ImapConfig, signal: AbortSignal) => Promise<Result<void, AppError>>;
  enqueue: (accountId: string) => Promise<void>;
}

// The "Outro provedor (IMAP/SMTP)" flow: validate the form once at the boundary, prove both logins
// work, then persist and kick off the first sync (otherwise the inbox stays empty until the next
// worker restart, see enqueueInitialSync).
export async function connectImapMailbox(
  db: Db,
  args: { userId: string; rawInput: unknown; deps: ConnectImapDeps; signal: AbortSignal },
): Promise<Result<{ accountId: string }, AppError>> {
  const parsed = imapConnectInputSchema.safeParse(args.rawInput);
  if (!parsed.success) {
    return err(
      new AppError("E_MAIL_006", "invalid imap connect input", { issues: parsed.error.issues }),
    );
  }
  const { emailAddress, password, ...settings } = parsed.data;
  const verified = await args.deps.verify({ ...settings, password }, args.signal);
  if (!verified.ok) return verified;
  args.signal.throwIfAborted();

  const bound = await bindImapAccount(db, {
    userId: args.userId,
    emailAddress,
    settings,
    password,
  });
  if (!bound.ok) return bound;
  await args.deps.enqueue(bound.value.accountId);
  return bound;
}
