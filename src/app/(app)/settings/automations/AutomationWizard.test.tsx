// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

const { createAutomationRuleAction } = vi.hoisted(() => ({
  createAutomationRuleAction: vi.fn(() => Promise.resolve({ ok: true, value: { id: "r1" } })),
}));
vi.mock("@/features/automations/actions", () => ({
  createAutomationRuleAction,
  updateAutomationRuleAction: vi.fn(),
  setAutomationRuleActiveAction: vi.fn(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    pipeline: { list: { useQuery: () => ({ data: [{ id: "p1", name: "Sales" }] }) } },
    activities: { listTypes: { useQuery: () => ({ data: [{ id: "t1", name: "Call" }] }) } },
  },
}));

import { AutomationWizard } from "./AutomationWizard";

it("submits a rule with the selected trigger, one action, and a name", async () => {
  render(<AutomationWizard initialRule={null} />);

  screen.getByLabelText("Automation name").focus();
  await import("@testing-library/user-event").then(({ default: userEvent }) =>
    userEvent.setup().type(screen.getByLabelText("Automation name"), "My Rule"),
  );

  screen.getByRole("button", { name: "Save" }).click();

  await waitFor(() => expect(createAutomationRuleAction).toHaveBeenCalled());
  const [input] = createAutomationRuleAction.mock.calls[0] as unknown as [Record<string, unknown>];
  expect(input.name).toBe("My Rule");
  expect(input.trigger).toBe("deal_created");
  expect(Array.isArray(input.actions)).toBe(true);
});
