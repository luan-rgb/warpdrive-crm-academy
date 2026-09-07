CREATE TYPE "public"."invoice_tax_mode" AS ENUM('exclusive', 'inclusive', 'none');--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "tax_rate_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "subtotal" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_total" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_mode" "invoice_tax_mode" DEFAULT 'exclusive' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bill_to_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bill_to_address" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bill_to_email" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bill_to_tax_id" text;