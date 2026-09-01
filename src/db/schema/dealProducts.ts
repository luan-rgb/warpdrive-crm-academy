import { index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { deals } from "./deals";
import { products } from "./products";

// Line items attaching a product to a deal. Own id (not a composite PK on dealId+productId)
// because the same product can appear on a deal more than once with a different price/note.
// name/unitPrice are snapshotted at add time so a later catalog price change or rename does not
// silently rewrite a deal that already quoted the old value.
export const dealProducts = pgTable(
  "deal_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 2 }).notNull().default("1"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("deal_products_deal_idx").on(t.dealId, t.position),
    index("deal_products_product_idx").on(t.productId),
  ],
);

export type DealProduct = typeof dealProducts.$inferSelect;
export type NewDealProduct = typeof dealProducts.$inferInsert;
