CREATE TABLE "deal_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quantity" numeric(14, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"price" numeric(14, 2) NOT NULL,
	"unit" text DEFAULT 'un' NOT NULL,
	"description" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_products_deal_idx" ON "deal_products" USING btree ("deal_id","position");--> statement-breakpoint
CREATE INDEX "deal_products_product_idx" ON "deal_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "products_archived_idx" ON "products" USING btree ("is_archived");--> statement-breakpoint
CREATE INDEX "products_sku_idx" ON "products" USING btree ("sku");