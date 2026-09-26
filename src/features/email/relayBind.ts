import { sql } from "drizzle-orm";
import { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { encryptToken } from "./crypto";
import { PG_UNIQUE_VIOLATION, pgErrorCode } from "./pgErrors";
import type { ClaimedMailbox } from "./relayConnect";

// Bind (or re-bind) the user's one mailbox to the Gmail/Outlook account claimed from the relay.
// The tenant encrypts the refresh token with its own key; switching provider wipes the IMAP
// credential and the Gmail history cursor so nothing stale is used against the new account.
export async function bindOAuthMailbox(
  db: Db,
  userId: string,
  mailbox: ClaimedMailbox,
): Promise<Result<{ accountId: string }, AppError>> {
  const email = mailbox.email.trim().toLowerCase();
  const enc = encryptToken(mailbox.refreshToken);
  try {
    const res = await db.execute(sql`
      INSERT INTO email_accounts (user_id, email_address, provider, refresh_token_enc, scopes, status)
      VALUES (${userId}, ${email}, ${mailbox.provider}, ${enc}, ${JSON.stringify(mailbox.scopes)}::jsonb, 'connected')
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
        updated_at = now()
      RETURNING id
    `);
    const row = res.rows[0] as { id: string } | undefined;
    if (row === undefined)
      return err(new AppError("E_DB_002", "oauth mailbox upsert returned no row", {}));
    return ok({ accountId: row.id });
  } catch (e) {
    // ON CONFLICT targets user_id, so a unique violation here is the email_address key: the
    // address is already connected by a different user, whose row stays untouched.
    if (pgErrorCode(e) === PG_UNIQUE_VIOLATION) {
      return err(new AppError("E_GMAIL_006", "mailbox address already bound to another user", {}));
    }
    throw e;
  }
}
