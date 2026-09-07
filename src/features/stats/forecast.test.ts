// Integration test: real Postgres, real migrations. Mirrors wonTrend.test.ts (bucketing, gap
// filling, scoping) plus the weighting math that is unique to the forecast.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deals } from "@/db/schema/deals";
import { stages } from "@/db/schema/stages";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { adminSession, seedSettings } from "@/features/deals/dealMove.test-helpers";
import type { DashboardFilters } from "@/types/stats";
import { forecast } from "./forecast";

type Db = Parameters<Parameters<typeof withTestDb>[0]>[0];

const BASE: DashboardFilters = {
  pipelineId: null,
  ownerScope: "all",
  from: "2026-01-01",
  to: "2026-04-30",
};

async function seedOpen(
  db: Db,
  args: {
    pipelineId: string;
    stageId: string;
    ownerId: string;
    expectedCloseDate: string | null;
    value: string;
    status?: "won" | "lost" | "open";
  },
) {
  await db.insert(deals).values({
    title: "Deal",
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    ownerId: args.ownerId,
    visibilityLevel: "all",
    status: args.status ?? "open",
    value: args.value,
    expectedCloseDate: args.expectedCloseDate,
  });
}

async function fixture(db: Db, probability: number | null) {
  await seedSettings(db);
  const user = await seedUser(db);
  const p = await seedPipelineWithStages(db, ["A"]);
  const stage = p.stages[0];
  if (stage === undefined) throw new Error("no stage");
  await db.update(stages).set({ probability }).where(eq(stages.id, stage.id));
  return { user, pipelineId: p.pipeline.id, stageId: stage.id };
}

describe("forecast", () => {
  it("buckets open deals by expected close month, weighted by stage probability", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db, 50);
      const common = { pipelineId: f.pipelineId, stageId: f.stageId, ownerId: f.user.id };
      await seedOpen(db, { ...common, expectedCloseDate: "2026-01-10", value: "1000.00" });
      await seedOpen(db, { ...common, expectedCloseDate: "2026-01-20", value: "500.00" });
      await seedOpen(db, { ...common, expectedCloseDate: "2026-03-05", value: "2000.00" });

      const points = await forecast(
        db,
        adminSession(f.user.id),
        BASE,
        new AbortController().signal,
      );

      expect(points.map((p) => p.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
      expect(points.map((p) => p.count)).toEqual([2, 0, 1, 0]);
      expect(points.map((p) => p.value)).toEqual(["1500.00", "0.00", "2000.00", "0.00"]);
      // 50% of 1500.00 and 50% of 2000.00.
      expect(points.map((p) => p.weightedValue)).toEqual(["750.00", "0.00", "1000.00", "0.00"]);
    });
  });

  it("weights a deal at 0 when its stage has no probability set, not a guess", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db, null);
      await seedOpen(db, {
        pipelineId: f.pipelineId,
        stageId: f.stageId,
        ownerId: f.user.id,
        expectedCloseDate: "2026-01-10",
        value: "1000.00",
      });

      const points = await forecast(
        db,
        adminSession(f.user.id),
        BASE,
        new AbortController().signal,
      );

      expect(points[0]?.value).toBe("1000.00");
      expect(points[0]?.weightedValue).toBe("0.00");
    });
  });

  it("excludes deals with no expected close date", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db, 100);
      await seedOpen(db, {
        pipelineId: f.pipelineId,
        stageId: f.stageId,
        ownerId: f.user.id,
        expectedCloseDate: null,
        value: "1000.00",
      });

      const points = await forecast(
        db,
        adminSession(f.user.id),
        BASE,
        new AbortController().signal,
      );

      expect(points.every((p) => p.count === 0)).toBe(true);
    });
  });

  it("ignores won and lost deals: forecast is for what has not closed yet", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db, 100);
      const common = { pipelineId: f.pipelineId, stageId: f.stageId, ownerId: f.user.id };
      await seedOpen(db, {
        ...common,
        expectedCloseDate: "2026-01-10",
        value: "1000.00",
        status: "won",
      });
      await seedOpen(db, {
        ...common,
        expectedCloseDate: "2026-01-10",
        value: "1000.00",
        status: "lost",
      });

      const points = await forecast(
        db,
        adminSession(f.user.id),
        BASE,
        new AbortController().signal,
      );

      expect(points.every((p) => p.count === 0)).toBe(true);
    });
  });
});
