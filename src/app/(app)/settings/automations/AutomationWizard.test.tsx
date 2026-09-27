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
    pipeline: {
      list: {
        useQuery: () => ({
          data: [{ id: "p1", name: "Sales", stages: [{ id: "s1", name: "Proposta" }] }],
        }),
      },
    },
    activities: { listTypes: { useQuery: () => ({ data: [{ id: "t1", name: "Call" }] }) } },
    identity: {
      assignableUsers: { useQuery: () => ({ data: [{ id: "u1", name: "Ana" }] }) },
    },
  },
}));

import { AutomationWizard } from "./AutomationWizard";

it("submits a rule with the selected trigger, one action, and a name", async () => {
  render(<AutomationWizard initialRule={null} />);

  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();

  screen.getByLabelText("Nome da automação").focus();
  await user.type(screen.getByLabelText("Nome da automação"), "My Rule");

  // Save stays disabled with zero actions (finding 5), so add one before saving.
  await user.click(screen.getByRole("button", { name: "+ Enviar notificação" }));

  screen.getByRole("button", { name: "Salvar" }).click();

  await waitFor(() => expect(createAutomationRuleAction).toHaveBeenCalled());
  const [input] = createAutomationRuleAction.mock.calls[0] as unknown as [Record<string, unknown>];
  expect(input.name).toBe("My Rule");
  expect(input.trigger).toBe("deal_created");
  expect(Array.isArray(input.actions)).toBe(true);
});

async function setup() {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  render(<AutomationWizard initialRule={null} />);
  await user.type(screen.getByLabelText("Nome da automação"), "Regra");
  return user;
}

async function savedInput(user: Awaited<ReturnType<typeof setup>>) {
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(createAutomationRuleAction).toHaveBeenCalled());
  return (createAutomationRuleAction.mock.calls[0] as unknown as [Record<string, unknown>])[0];
}

it("saves a condition typed in the conditions editor", async () => {
  const user = await setup();
  await user.click(screen.getByRole("button", { name: "+ Enviar notificação" }));
  await user.click(screen.getByRole("button", { name: "+ Adicionar condição" }));
  await user.type(screen.getByLabelText("Valor da condição 1"), "10000");
  const input = await savedInput(user);
  expect(input.conditions).toEqual([{ field: "value", op: "gt", value: "10000" }]);
});

it("adds a webhook action with its URL", async () => {
  const user = await setup();
  await user.click(screen.getByRole("button", { name: "+ Chamar webhook" }));
  await user.type(screen.getByLabelText("URL do webhook"), "https://hooks.example.com/x");
  const input = await savedInput(user);
  expect(input.actions).toEqual([
    { actionType: "webhook", config: { url: "https://hooks.example.com/x" } },
  ]);
});

it("adds a note action with its text", async () => {
  const user = await setup();
  await user.click(screen.getByRole("button", { name: "+ Adicionar anotação" }));
  await user.type(screen.getByLabelText("Texto da anotação"), "Ligar amanhã");
  const input = await savedInput(user);
  expect(input.actions).toEqual([
    { actionType: "add_note", config: { contentTemplate: "Ligar amanhã" } },
  ]);
});

it("offers a stage picker for a stage-change rule of a chosen pipeline", () => {
  render(
    <AutomationWizard
      initialRule={{
        rule: {
          id: "r1",
          name: "R",
          description: null,
          pipelineId: "p1",
          trigger: "deal_stage_changed",
          triggerConfig: { toStageId: "s1" },
          conditions: [],
          ownerId: "u1",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        actions: [],
      }}
    />,
  );
  expect(screen.getByRole("combobox", { name: "Etapa de destino" })).toHaveTextContent("Proposta");
});
