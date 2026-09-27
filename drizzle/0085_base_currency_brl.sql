-- Every CRM Academy tenant runs in reais. The base currency is read-only in the UI, so a row still
-- on the old 'USD' column default was never a deliberate choice.
ALTER TABLE "settings" ALTER COLUMN "base_currency" SET DEFAULT 'BRL';--> statement-breakpoint
UPDATE "settings" SET "base_currency" = 'BRL' WHERE "base_currency" = 'USD';
