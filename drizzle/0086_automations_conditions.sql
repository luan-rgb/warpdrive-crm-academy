ALTER TYPE "public"."automation_action_type" ADD VALUE 'add_note';--> statement-breakpoint
ALTER TYPE "public"."automation_action_type" ADD VALUE 'webhook';--> statement-breakpoint
ALTER TYPE "public"."automation_trigger" ADD VALUE 'activity_created';--> statement-breakpoint
ALTER TYPE "public"."automation_trigger" ADD VALUE 'activity_completed';--> statement-breakpoint
ALTER TABLE "automation_rules" ADD COLUMN "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL;