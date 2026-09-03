// @vitest-environment node
// Boundary-validation tests for the automation rule server actions. Same next/headers + context
// mocking pattern as custom-fields/actions.test.ts: guardCsrf and the permission gate run for
// real, while rulesRepo is spied so no DB is touched. Proves invalid input never reaches the repo,
// and that a caller without automation.manage is rejected before the repo is called.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { CSRF_COOKIE } from "@/features/auth/csrf";

const headerStore = new Map<string, string>();
const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve({ get: (k: string) => headerStore.get(k.toLowerCase()) ?? null }),
  cookies: () =>
    Promise.resolve({
      get: (k: string) => {
        const value = cookieStore.get(k);
        return value === undefined ? undefined : { value };
      },
    }),
}));

vi.mock("@/db/client", () => ({ db: {} }));

let canAllows = true;
vi.mock("@/features/permissions/can", () => ({ can: () => canAllows }));

const actorRef: { current: { id: string } | null } = {
  current: { id: "user-1" },
};
vi.mock("@/server/trpc/context", () => ({
  createContext: vi.fn(() => Promise.resolve({ actor: actorRef.current, session: null, db: {} })),
}));

const {
  createAutomationRule,
  updateAutomationRule,
  setAutomationRuleActive,
  deleteAutomationRule,
} = vi.hoisted(() => ({
  createAutomationRule: vi.fn(() => Promise.resolve({ ok: true as const, value: { id: "r1" } })),
  updateAutomationRule: vi.fn(() => Promise.resolve({ ok: true as const, value: { id: "r1" } })),
  setAutomationRuleActive: vi.fn(() => Promise.resolve({ ok: true as const, value: { id: "r1" } })),
  deleteAutomationRule: vi.fn(() => Promise.resolve({ ok: true as const, value: true })),
}));
vi.mock("./rulesRepo", () => ({
  createAutomationRule,
  updateAutomationRule,
  setAutomationRuleActive,
  deleteAutomationRule,
}));

import {
  createAutomationRuleAction,
  deleteAutomationRuleAction,
  setAutomationRuleActiveAction,
  updateAutomationRuleAction,
} from "./actions";

const VALID_TOKEN = "csrf-test-token";
const validRule = {
  name: "Notify on stage change",
  description: null,
  pipelineId: null,
  trigger: "deal_created" as const,
  triggerConfig: {},
  actions: [{ actionType: "send_notification" as const, config: { messageTemplate: "hi" } }],
  isActive: true,
};

function setSameOrigin(): void {
  headerStore.set("origin", "https://app.example.com");
  headerStore.set("sec-fetch-site", "same-origin");
  cookieStore.set(CSRF_COOKIE, VALID_TOKEN);
}

beforeEach(() => {
  headerStore.clear();
  cookieStore.clear();
  canAllows = true;
  actorRef.current = { id: "user-1" };
  vi.clearAllMocks();
});

describe("createAutomationRuleAction", () => {
  test("rejects an empty name without calling the repo", async () => {
    setSameOrigin();
    const r = await createAutomationRuleAction({ ...validRule, name: "  " }, VALID_TOKEN);
    expect(r.ok).toBe(false);
    expect(createAutomationRule).not.toHaveBeenCalled();
  });

  test("rejects a rule with zero actions without calling the repo", async () => {
    setSameOrigin();
    const r = await createAutomationRuleAction({ ...validRule, actions: [] }, VALID_TOKEN);
    expect(r.ok).toBe(false);
    expect(createAutomationRule).not.toHaveBeenCalled();
  });

  test("passes valid input through to the repo", async () => {
    setSameOrigin();
    const r = await createAutomationRuleAction(validRule, VALID_TOKEN);
    expect(r.ok).toBe(true);
    expect(createAutomationRule).toHaveBeenCalledTimes(1);
  });

  test("rejects when the actor lacks automation.manage", async () => {
    setSameOrigin();
    canAllows = false;
    const r = await createAutomationRuleAction(validRule, VALID_TOKEN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.id).toBe("E_PERM_001");
    expect(createAutomationRule).not.toHaveBeenCalled();
  });

  test("rejects when there is no authenticated actor", async () => {
    setSameOrigin();
    actorRef.current = null;
    const r = await createAutomationRuleAction(validRule, VALID_TOKEN);
    expect(r.ok).toBe(false);
    expect(createAutomationRule).not.toHaveBeenCalled();
  });

  test("rejects a bad CSRF token before touching the repo", async () => {
    const r = await createAutomationRuleAction(validRule, "wrong-token");
    expect(r.ok).toBe(false);
    expect(createAutomationRule).not.toHaveBeenCalled();
  });
});

describe("updateAutomationRuleAction", () => {
  test("rejects an invalid id", async () => {
    setSameOrigin();
    const r = await updateAutomationRuleAction({ ...validRule, id: "not-a-uuid" }, VALID_TOKEN);
    expect(r.ok).toBe(false);
    expect(updateAutomationRule).not.toHaveBeenCalled();
  });

  test("passes valid input through to the repo", async () => {
    setSameOrigin();
    const r = await updateAutomationRuleAction(
      { ...validRule, id: "00000000-0000-0000-0000-000000000000" },
      VALID_TOKEN,
    );
    expect(r.ok).toBe(true);
    expect(updateAutomationRule).toHaveBeenCalledTimes(1);
  });
});

describe("setAutomationRuleActiveAction", () => {
  test("passes valid input through to the repo", async () => {
    setSameOrigin();
    const r = await setAutomationRuleActiveAction(
      { id: "00000000-0000-0000-0000-000000000000", isActive: false },
      VALID_TOKEN,
    );
    expect(r.ok).toBe(true);
    expect(setAutomationRuleActive).toHaveBeenCalledTimes(1);
  });
});

describe("deleteAutomationRuleAction", () => {
  test("rejects an invalid id", async () => {
    setSameOrigin();
    const r = await deleteAutomationRuleAction({ id: "not-a-uuid" }, VALID_TOKEN);
    expect(r.ok).toBe(false);
    expect(deleteAutomationRule).not.toHaveBeenCalled();
  });

  test("passes valid input through to the repo", async () => {
    setSameOrigin();
    const r = await deleteAutomationRuleAction(
      { id: "00000000-0000-0000-0000-000000000000" },
      VALID_TOKEN,
    );
    expect(r.ok).toBe(true);
    expect(deleteAutomationRule).toHaveBeenCalledTimes(1);
  });
});
