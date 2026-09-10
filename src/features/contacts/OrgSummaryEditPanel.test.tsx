// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type UpdateResultLike = { ok: true; value: { id: string } } | { ok: false; error: { id: string } };

const { updateOrgAction } = vi.hoisted(() => ({
  updateOrgAction: vi.fn(
    (): Promise<UpdateResultLike> => Promise.resolve({ ok: true, value: { id: "o1" } }),
  ),
}));
vi.mock("./actions", () => ({ updateOrgAction }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

import { OrgSummaryEditPanel } from "./OrgSummaryEditPanel";

const org = {
  id: "o1",
  name: "Acme Inc",
  address: { street: "1 Main St", city: "Munich", region: "Bavaria", country: "DE" },
};

describe("OrgSummaryEditPanel", () => {
  it("saves an edited Name", async () => {
    render(<OrgSummaryEditPanel org={org} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Nome" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "New" } });
    fireEvent.keyDown(screen.getByLabelText("Nome"), { key: "Enter" });

    await vi.waitFor(() => expect(updateOrgAction).toHaveBeenCalled());
    const [payload, csrf] = updateOrgAction.mock.calls[0] as unknown as [
      Record<string, unknown>,
      string,
    ];
    expect(payload).toMatchObject({ id: "o1", name: "New" });
    expect(csrf).toBe("csrf");
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("saves an edited City as the assembled address object", async () => {
    render(<OrgSummaryEditPanel org={org} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Cidade" }));
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Berlin" } });
    fireEvent.keyDown(screen.getByLabelText("Cidade"), { key: "Enter" });

    await vi.waitFor(() => expect(updateOrgAction).toHaveBeenCalled());
    const [payload] = updateOrgAction.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(payload).toMatchObject({
      id: "o1",
      address: { ...org.address, city: "Berlin" },
    });
  });

  it("clears an address field by sending undefined when the input is emptied", async () => {
    render(<OrgSummaryEditPanel org={org} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Região" }));
    fireEvent.change(screen.getByLabelText("Região"), { target: { value: "" } });
    fireEvent.keyDown(screen.getByLabelText("Região"), { key: "Enter" });

    await vi.waitFor(() => expect(updateOrgAction).toHaveBeenCalled());
    const [payload] = updateOrgAction.mock.calls[0] as unknown as [Record<string, unknown>, string];
    const address = payload.address as Record<string, unknown>;
    expect(address.region).toBeUndefined();
    expect(address.city).toBe("Munich");
  });

  it("renders '+ Add' placeholders for a null address", () => {
    render(<OrgSummaryEditPanel org={{ id: "o1", name: "Acme Inc", address: null }} />);
    expect(screen.getAllByText("+ Adicionar").length).toBeGreaterThanOrEqual(4);
  });

  it("calls onSaved instead of router.refresh when provided", async () => {
    const onSaved = vi.fn();
    render(<OrgSummaryEditPanel org={org} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Nome" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "New" } });
    fireEvent.keyDown(screen.getByLabelText("Nome"), { key: "Enter" });

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("surfaces a save failure via an inline error", async () => {
    updateOrgAction.mockResolvedValueOnce({ ok: false, error: { id: "E_CONTACT_002" } });
    render(<OrgSummaryEditPanel org={org} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Nome" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "New" } });
    fireEvent.keyDown(screen.getByLabelText("Nome"), { key: "Enter" });

    expect(await screen.findByText(/não foi possível salvar/i)).toBeInTheDocument();
  });

  // CONTACTS-20 / INLINE-EDIT-13: a failed save must NOT trigger router.refresh(), which would
  // re-render the row and wipe the inline error the user needs to see (and their typed value).
  it("does not refresh on a failed save (keeps the inline error visible)", async () => {
    updateOrgAction.mockResolvedValueOnce({ ok: false, error: { id: "E_CONTACT_002" } });
    render(<OrgSummaryEditPanel org={org} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Nome" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "New" } });
    fireEvent.keyDown(screen.getByLabelText("Nome"), { key: "Enter" });

    expect(await screen.findByText(/não foi possível salvar/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
