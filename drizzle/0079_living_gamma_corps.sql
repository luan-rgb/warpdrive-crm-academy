CREATE TYPE "public"."automation_action_type" AS ENUM('create_activity', 'send_notification', 'send_email', 'update_field');--> statement-breakpoint
CREATE TYPE "public"."automation_run_action_status" AS ENUM('success', 'error', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."automation_run_status" AS ENUM('success', 'error', 'partial');--> statement-breakpoint
CREATE TYPE "public"."automation_trigger" AS ENUM('deal_created', 'deal_stage_changed', 'deal_status_changed', 'deal_field_changed');--> statement-breakpoint
CREATE TABLE "automation_rule_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"action_type" "automation_action_type" NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"pipeline_id" uuid,
	"trigger" "automation_trigger" NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"action_type" "automation_action_type" NOT NULL,
	"status" "automation_run_action_status" NOT NULL,
	"error_message" text,
	"result_summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid,
	"rule_name" text NOT NULL,
	"deal_id" uuid NOT NULL,
	"trigger" "automation_trigger" NOT NULL,
	"status" "automation_run_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "automation_rule_actions" ADD CONSTRAINT "automation_rule_actions_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run_actions" ADD CONSTRAINT "automation_run_actions_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rule_actions_rule_idx" ON "automation_rule_actions" USING btree ("rule_id","position");--> statement-breakpoint
CREATE INDEX "automation_run_actions_run_idx" ON "automation_run_actions" USING btree ("run_id","position");--> statement-breakpoint
CREATE INDEX "automation_runs_rule_idx" ON "automation_runs" USING btree ("rule_id","started_at");--> statement-breakpoint
CREATE INDEX "automation_runs_deal_idx" ON "automation_runs" USING btree ("deal_id","started_at");