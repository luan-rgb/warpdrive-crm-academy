// @vitest-environment node
// Bulk deal actions are public POST endpoints: the TypeScript signature does not protect them.
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/features/identity/actions/shared", () => ({
  guardCsrf: () => Promise.resolve({ ok: true as const }),
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => Promise.resolve({ actor: { id: "u1" }, session: null, db: {} }),
}));
const { archiveDeals, bulkUpdateStage } = vi.hoisted(() => ({
  archiveDeals: vi.fn(() => Promise.resolve({ ok: true as const, value: 1 })),
  bulkUpdateStage: vi.fn(() => Promise.resolve({ ok: true as const, value: [] })),
}));
vi.mock("./bulkArchive", () => ({ archiveDeals }));
vi.mock("./archiveDeal", () => ({ archiveDeal: vi.fn() }));
vi.mock("./bulkActions", () => ({ bulkUpdateStage }));

import { archiveDealsAction } from "./archiveActions";
import { bulkStageAction } from "./bulkStageAction";

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  archiveDeals.mockClear();
  bulkUpdateStage.mockClear();
});

it("archiveDealsAction refuses non-uuid ids, a missing flag and oversized batches", async () => {
  for (const [ids, archived] of [
    [["not-a-uuid"], true],
    [[ID], "yes"],
    [Array.from({ length: 501 }, () => ID), true],
  ] as const) {
    const r = await archiveDealsAction(ids as unknown as string[], archived as unknown as boolean);
    expect(r).toEqual({ ok: false, error: { id: "E_DEAL_014" } });
  }
  expect(archiveDeals).not.toHaveBeenCalled();
});

it("bulkStageAction validates the batch before touching the database", async () => {
  const r = await bulkStageAction({ dealIds: ["x"], toStageId: ID });
  expect(r).toEqual({ ok: false, error: { id: "E_DEAL_014" } });
  expect(bulkUpdateStage).not.toHaveBeenCalled();
});
