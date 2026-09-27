// @vitest-environment node
import { expect, it, vi } from "vitest";

vi.mock("@/features/identity/actions/shared", () => ({
  guardCsrf: () => Promise.resolve({ ok: true as const }),
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => Promise.resolve({ actor: { id: "u1" }, session: null, db: {} }),
}));
const { completeActivity } = vi.hoisted(() => ({ completeActivity: vi.fn() }));
vi.mock("./repo", () => ({ completeActivity, createActivity: vi.fn() }));

import { completeActivityAction } from "./actions";

it("completeActivityAction refuses a bad id or a non-boolean flag", async () => {
  const bad = await completeActivityAction({ id: "x", done: "sim" } as unknown as {
    id: string;
    done: boolean;
  });
  expect(bad).toEqual({ ok: false, error: { id: "E_ACTIVITY_008" } });
  expect(completeActivity).not.toHaveBeenCalled();
});
