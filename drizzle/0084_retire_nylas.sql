-- Retire the paid Nylas integration. A Nylas grant cannot be turned into a Google/Microsoft
-- refresh token, so those mailboxes are disconnected with E_MAIL_008 (the Email sync page explains
-- it and offers the free Gmail/Outlook/IMAP options). The row stays, so already-synced threads and
-- messages remain, and reconnecting reuses the same account (ON CONFLICT (user_id)).
UPDATE "email_accounts"
SET "status" = 'disconnected', "last_error_id" = 'E_MAIL_008', "refresh_token_enc" = NULL, "updated_at" = now()
WHERE "nylas_grant_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "email_accounts" DROP COLUMN "nylas_grant_id";
