import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { pipelines } from "./pipelines";

export const stages = pgTable(
  "stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    order: integer("order").notNull().default(0),
    rottingDays: integer("rotting_days"),
    // Percentage (0-100) chance a deal in this stage closes won, used to weight the revenue
    // forecast. Null, not a made-up default, until an admin sets it: an unset probability
    // contributes 0 to the weighted forecast rather than a guessed percentage.
    probability: integer("probability"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("stages_pipeline_order_idx").on(t.pipelineId, t.order),
    // UNIQUE (id, pipeline_id) is the composite-FK target for deals.stage.
    unique("stages_id_pipeline_uq").on(t.id, t.pipelineId),
    check(
      "stages_probability_range_ck",
      sql`probability IS NULL OR (probability >= 0 AND probability <= 100)`,
    ),
  ],
);

export type Stage = typeof stages.$inferSelect;
export type NewStage = typeof stages.$inferInsert;
