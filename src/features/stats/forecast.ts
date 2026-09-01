// Revenue forecast for open deals, grouped by expected_close_date month. Unlike wonTrend (which
// windows on won_time because a closed deal always has one), an open deal is windowed on its own
// expected_close_date: a deal with none set falls outside every month bucket and is excluded,
// the same way a deal with no value is excluded from a sum rather than counted as zero.
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dealVisibilityClause } from "@/features/deals/visibility";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DashboardFilters, ForecastPoint } from "@/types/stats";
import { monthsInRange, windowStart } from "./monthBuckets";

function toSession(actor: PermSetUser) {
  return {
    userId: actor.id,
    isAdmin: actor.type === "admin",
    isActive: actor.isActive,
    sessionLive: true,
    visibilityGroupIds: Array.from(actor.groupIds),
    managedUserIds: Array.from(actor.managedUserIds ?? []),
  };
}

interface Row {
  month: string;
  count: number;
  value: string;
  weightedValue: string;
}

export async function forecast(
  db: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  signal: AbortSignal,
): Promise<ForecastPoint[]> {
  signal.throwIfAborted();

  const months = monthsInRange(filters.from, filters.to);
  const start = windowStart(filters.from, months);
  if (start === null) return [];

  const visClause = dealVisibilityClause(toSession(actor));
  const ownerClause = filters.ownerScope === "me" ? sql`AND d.owner_id = ${actor.id}::uuid` : sql``;
  const pipelineClause =
    filters.pipelineId !== null ? sql`AND d.pipeline_id = ${filters.pipelineId}` : sql``;

  const result = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', d.expected_close_date), 'YYYY-MM') AS "month",
      count(*)::int AS "count",
      coalesce(sum(d.value), 0)::numeric(14,2)::text AS "value",
      coalesce(sum(d.value * coalesce(s.probability, 0) / 100.0), 0)::numeric(14,2)::text
        AS "weightedValue"
    FROM deals d
    JOIN pipelines p ON p.id = d.pipeline_id
    JOIN stages s ON s.id = d.stage_id
    WHERE d.deleted_at IS NULL
      AND d.archived_at IS NULL
      AND p.is_archived = false
      AND d.status = 'open'
      AND d.expected_close_date >= ${start}::date
      AND d.expected_close_date < ${filters.to}::date + INTERVAL '1 day'
      ${pipelineClause}
      ${ownerClause}
      AND ${visClause}
    GROUP BY 1
  `);

  signal.throwIfAborted();

  const byMonth = new Map<string, Row>();
  for (const row of (result as unknown as { rows: Row[] }).rows) byMonth.set(row.month, row);

  return months.map((month) => {
    const row = byMonth.get(month);
    return {
      month,
      count: row?.count ?? 0,
      value: row?.value ?? "0.00",
      weightedValue: row?.weightedValue ?? "0.00",
    };
  });
}
