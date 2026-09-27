// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    automations: {
      listRunsForRule: {
        useQuery: () => ({
          isLoading: false,
          data: [
            {
              id: "run1",
              dealId: "d1",
              dealTitle: "Acme",
              trigger: "deal_created",
              status: "partial",
              startedAt: new Date("2026-09-20T12:00:00Z"),
              finishedAt: new Date("2026-09-20T12:00:02Z"),
              actions: [
                {
                  position: 0,
                  actionType: "send_notification",
                  status: "success",
                  errorMessage: null,
                },
                {
                  position: 1,
                  actionType: "send_email",
                  status: "error",
                  errorMessage: "E_AUTOMATION_004: o responsável não tem caixa de e-mail",
                },
              ],
            },
          ],
        }),
      },
    },
  },
}));

import { RunHistory } from "./RunHistory";

it("lists each run with its deal, overall result and every action's outcome", () => {
  render(<RunHistory ruleId="r1" />);
  expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute("href", "/deals/d1");
  expect(screen.getByText("Parcial")).toBeInTheDocument();
  expect(screen.getByText(/Enviar notificação/)).toBeInTheDocument();
  expect(screen.getByText(/o responsável não tem caixa de e-mail/)).toBeInTheDocument();
});
