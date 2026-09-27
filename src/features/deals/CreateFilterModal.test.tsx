// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const createSavedFilterAction = vi.fn();
vi.mock("@/features/saved-filters/serverActions", () => ({
  createSavedFilterAction: (...args: unknown[]) => createSavedFilterAction(...args),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    labels: {
      listByTarget: { useQuery: () => ({ data: [{ name: "Hot" }] }) },
      appliedNames: { useQuery: () => ({ data: [] }) },
    },
  },
}));

import { CreateFilterModal } from "./CreateFilterModal";

afterEach(() => {
  cleanup();
  createSavedFilterAction.mockReset();
});

const STAGES = [{ id: "s1", name: "Qualified" }];
const OWNERS = [{ ownerId: "u1", name: "Ada King" }];

describe("CreateFilterModal", () => {
  it("renders a Create new filter dialog with one condition row", () => {
    render(<CreateFilterModal onClose={() => {}} onSave={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Criar novo filtro" })).not.toBeNull();
    expect(screen.getAllByLabelText(/Campo da condição \d+/)).toHaveLength(1);
  });

  it("adds a condition row", () => {
    render(<CreateFilterModal onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    expect(screen.getAllByLabelText(/Campo da condição \d+/)).toHaveLength(2);
  });

  // The saved-filter modal and the ad-hoc popover used to offer different deal fields. Both now
  // read the one catalog, so the saved side gets Stage, Expected close, Organization and Label.
  it("offers the whole deal catalog", () => {
    render(<CreateFilterModal onClose={() => {}} onSave={() => {}} stages={STAGES} />);
    fireEvent.click(screen.getByLabelText("Campo da condição 1"));
    for (const label of ["Organização", "Etapa", "Data prevista de fechamento", "Etiqueta"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("renders a DatePicker, not a text box, once Expected close is picked", () => {
    const { container } = render(
      <CreateFilterModal onClose={() => {}} onSave={() => {}} stages={STAGES} />,
    );
    fireEvent.click(screen.getByLabelText("Campo da condição 1"));
    fireEvent.click(screen.getByRole("option", { name: "Data prevista de fechamento" }));
    expect(screen.getByLabelText("Valor da condição 1").tagName).toBe("BUTTON");
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it("saves via the server action and reports the AST definition, dropping empty rows", async () => {
    createSavedFilterAction.mockResolvedValue({ ok: true, value: { id: "srv-1" } });
    const onSave = vi.fn();
    render(<CreateFilterModal onClose={() => {}} onSave={onSave} />);
    // Add a second row and leave it empty so it is dropped.
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    fireEvent.change(screen.getByLabelText("Nome do filtro"), { target: { value: "Big deals" } });
    fireEvent.change(screen.getByLabelText("Valor da condição 1"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as {
      id: string;
      name: string;
      definition: { conditions: Array<{ field: string; op: string; value: string }> };
    };
    expect(saved.id).toBe("srv-1");
    expect(saved.name).toBe("Big deals");
    expect(saved.definition.conditions).toEqual([
      { field: "title", op: "contains", value: "Acme" },
    ]);

    // The server action received the same definition + a shared flag.
    const [input] = createSavedFilterAction.mock.calls[0]!;
    expect((input as { definition: { conditions: unknown[] } }).definition.conditions).toHaveLength(
      1,
    );
    expect((input as { isShared: boolean }).isShared).toBe(false);
  });

  // An error id on screen tells the user nothing they can act on. The copy has to name the problem.
  it("renders human copy, not an error id, when the save is rejected", async () => {
    createSavedFilterAction.mockResolvedValue({ ok: false, error: { id: "E_DEAL_008" } });
    const onSave = vi.fn();
    render(<CreateFilterModal onClose={() => {}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Valor da condição 1"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(screen.getByText("Uma dessas condições não é válida")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/E_DEAL_008/)).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  // A value the field cannot accept blocks the save before the round trip. Only the guard's own
  // unit tests can produce one: type="number" sanitizes a typed "ten" to "", and the DatePicker
  // has no free-text entry, so the row never carries a malformed value through this UI.
  it("keeps the save available for a value the field accepts", () => {
    render(<CreateFilterModal onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByLabelText("Campo da condição 1"));
    fireEvent.click(screen.getByRole("option", { name: "Valor" }));
    fireEvent.change(screen.getByLabelText("Valor da condição 1"), { target: { value: "1000" } });
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  // A saved deal filter was AND-only, so "any of these" was unreachable from the saved side.
  it("offers the all/any combinator once there is more than one condition", () => {
    render(<CreateFilterModal onClose={() => {}} onSave={() => {}} />);
    expect(screen.queryByLabelText("Combinador de correspondência")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    expect(screen.getByLabelText("Combinador de correspondência")).toBeInTheDocument();
  });

  it("saves the chosen combinator with the definition", async () => {
    createSavedFilterAction.mockResolvedValue({ ok: true, value: { id: "srv-2" } });
    const onSave = vi.fn();
    render(<CreateFilterModal onClose={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    fireEvent.change(screen.getByLabelText("Valor da condição 1"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Valor da condição 2"), { target: { value: "Corp" } });
    fireEvent.click(screen.getByLabelText("Combinador de correspondência"));
    fireEvent.click(screen.getByRole("option", { name: "qualquer condição" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as { definition: { combinator: string } };
    expect(saved.definition.combinator).toBe("or");
    const [input] = createSavedFilterAction.mock.calls[0]!;
    expect((input as { definition: { combinator: string } }).definition.combinator).toBe("or");
  });

  it("reopens a saved any-of filter as any, not a reset all", () => {
    render(
      <CreateFilterModal
        onClose={() => {}}
        onSave={() => {}}
        initialDefinition={{
          combinator: "or",
          conditions: [
            { field: "title", op: "contains", value: "Acme" },
            { field: "title", op: "contains", value: "Corp" },
          ],
        }}
      />,
    );
    expect(screen.getAllByLabelText(/Campo da condição \d+/)).toHaveLength(2);
    expect(screen.getByLabelText("Combinador de correspondência")).toHaveTextContent(
      "qualquer condição",
    );
  });

  it("closes via the X button", () => {
    const onClose = vi.fn();
    render(<CreateFilterModal onClose={onClose} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("auto-populates the filter name from the conditions until the user edits it", () => {
    render(<CreateFilterModal onClose={() => {}} onSave={() => {}} />);
    fireEvent.change(screen.getByLabelText("Valor da condição 1"), { target: { value: "Acme" } });
    const nameInput = screen.getByLabelText<HTMLInputElement>("Nome do filtro");
    expect(nameInput.value).toBe("Título contém Acme");
    // Once the user types their own name, auto-population stops overwriting it.
    fireEvent.change(nameInput, { target: { value: "My filter" } });
    fireEvent.change(screen.getByLabelText("Valor da condição 1"), {
      target: { value: "Acme Corp" },
    });
    expect(nameInput.value).toBe("My filter");
  });

  it("names an owner condition after the owner, not their id", () => {
    render(<CreateFilterModal onClose={() => {}} onSave={() => {}} owners={OWNERS} />);
    fireEvent.click(screen.getByLabelText("Campo da condição 1"));
    fireEvent.click(screen.getByRole("option", { name: "Responsável" }));
    fireEvent.click(screen.getByLabelText("Valor da condição 1"));
    fireEvent.click(screen.getByRole("option", { name: "Ada King" }));
    expect(screen.getByLabelText<HTMLInputElement>("Nome do filtro").value).toBe(
      "Responsável é Ada King",
    );
  });

  it("previews the in-progress definition without saving it", () => {
    const onPreview = vi.fn();
    render(<CreateFilterModal onClose={() => {}} onSave={() => {}} onPreview={onPreview} />);
    fireEvent.change(screen.getByLabelText("Valor da condição 1"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Visualizar" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview.mock.calls[0]![0]).toEqual({
      combinator: "and",
      conditions: [{ field: "title", op: "contains", value: "Acme" }],
    });
    // Preview must not persist anything.
    expect(createSavedFilterAction).not.toHaveBeenCalled();
  });

  it("applies the in-progress definition ad-hoc (Apply) without saving, then closes", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<CreateFilterModal onClose={onClose} onSave={() => {}} onApply={onApply} />);
    fireEvent.change(screen.getByLabelText("Valor da condição 1"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0]).toEqual({
      combinator: "and",
      conditions: [{ field: "title", op: "contains", value: "Acme" }],
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Apply is ad-hoc: it must not persist a saved filter.
    expect(createSavedFilterAction).not.toHaveBeenCalled();
  });
});
