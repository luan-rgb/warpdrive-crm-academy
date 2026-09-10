// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_DEAL_SIDEBAR_SECTIONS } from "@/constants/dealSidebarSections";
import { setSidebarSectionsAction } from "@/features/identity/preferencesActions";
import { ManageSectionsDialog } from "./ManageSectionsDialog";

const setSidebarSectionsMock = vi.mocked(setSidebarSectionsAction);

vi.mock("@/features/identity/preferencesActions", () => ({
  setSidebarSectionsAction: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
const reportError = vi.fn();
vi.mock("@/features/deal-workspace/DealActionErrorProvider", () => ({
  useDealActionError: () => reportError,
}));

afterEach(() => {
  cleanup();
  reportError.mockClear();
});

it("reorders, hides a section, and saves the sidebar section preferences", async () => {
  const user = userEvent.setup();
  render(
    <ManageSectionsDialog
      open
      onOpenChange={vi.fn()}
      sections={DEFAULT_DEAL_SIDEBAR_SECTIONS}
      onSaved={vi.fn()}
    />,
  );

  expect(screen.getByText("Resumo")).toBeInTheDocument();
  expect(screen.getByText("Origem")).toBeInTheDocument();
  expect(screen.queryByText("Detalhes")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Mover Origem para cima" }));
  await user.click(screen.getByRole("checkbox", { name: "Mostrar Origem" }));
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  // Default order is summary, products, invoices, source, ...: moving Source up swaps it with
  // the item directly above it (invoices), not with summary or products.
  const expected = [
    { id: "summary", visible: true },
    { id: "products", visible: true },
    { id: "source", visible: false },
    { id: "invoices", visible: true },
    ...DEFAULT_DEAL_SIDEBAR_SECTIONS.slice(4),
  ];
  await waitFor(() =>
    expect(setSidebarSectionsAction).toHaveBeenCalledWith({ sections: expected }, "csrf"),
  );
});

it("surfaces the error when saving sections is denied (no silent swallow)", async () => {
  setSidebarSectionsMock.mockResolvedValueOnce({
    ok: false,
    error: { id: "E_PERM_001" },
  });
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const user = userEvent.setup();
  render(
    <ManageSectionsDialog
      open
      onOpenChange={onOpenChange}
      sections={DEFAULT_DEAL_SIDEBAR_SECTIONS}
      onSaved={onSaved}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(reportError).toHaveBeenCalledWith("E_PERM_001"));
  expect(onSaved).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
});
