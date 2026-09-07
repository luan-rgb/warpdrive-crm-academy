import { boolean, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Catalog: global metadata like labels/customFieldDefs, not actor-scoped. Any user with
// products.manage can maintain it; every user can read it to build a deal's line items.
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sku: text("sku"),
    // numeric(14,2): money in base currency, same precision as deals.value.
    price: numeric("price", { precision: 14, scale: 2 }).notNull(),
    unit: text("unit").notNull().default("un"),
    description: text("description"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("products_archived_idx").on(t.isArchived), index("products_sku_idx").on(t.sku)],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
