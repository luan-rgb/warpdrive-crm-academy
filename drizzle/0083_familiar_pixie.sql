CREATE TYPE "public"."email_provider" AS ENUM('gmail', 'outlook', 'imap');--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "provider" "email_provider" DEFAULT 'gmail' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "imap_settings" jsonb;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "imap_password_enc" "bytea";