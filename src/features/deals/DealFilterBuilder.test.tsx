// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    identity: { assignableUsers: { useQuery: () => ({ data: [] }) } },
    labels: {
      listByTarget: { useQuery: () => ({ data: [{ name: "Hot" }] }) },
      appliedNames: { useQuery: () => ({ data: ["Cold"] }) },
    },
  },
}));

import { DealFilterBuilder } from "./DealFilterBuilder";

afterEach(cleanup);

const STAGES = [{ id: "s1", name: "Qualified" }];

describe("DealFilterBuilder", () => {
  it("applies a typed condition as a deal filter definition", () => {
    const onApply = vi.fn();
    render(<DealFilterBuilder stages={STAGES} activeCount={0} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtro" }));
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    fireEvent.change(screen.getByLabelText("Valor da condição 1"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    // Default first field is Title, whose first operator is "contains" (TEXT_OPS order).
    expect(onApply).toHaveBeenCalledWith({
      combinator: "and",
      conditions: [{ field: "title", op: "contains", value: "acme" }],
    });
  });

  // Deals used to hide the selector and hardcode AND, so "any of these" was unreachable.
  it("offers the all/any combinator once there is more than one condition", () => {
    render(<DealFilterBuilder stages={STAGES} activeCount={0} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtro" }));
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    expect(screen.queryByLabelText("Combinador de correspondência")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    expect(screen.getByLabelText("Combinador de correspondência")).toBeInTheDocument();
  });

  it("applies the chosen combinator with the conditions", () => {
    const onApply = vi.fn();
    render(<DealFilterBuilder stages={STAGES} activeCount={0} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtro" }));
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    fireEvent.change(screen.getByLabelText("Valor da condição 1"), { target: { value: "acme" } });
    fireEvent.change(screen.getByLabelText("Valor da condição 2"), { target: { value: "corp" } });
    fireEvent.click(screen.getByLabelText("Combinador de correspondência"));
    fireEvent.click(screen.getByRole("option", { name: "qualquer condição" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(onApply).toHaveBeenCalledWith({
      combinator: "or",
      conditions: [
        { field: "title", op: "contains", value: "acme" },
        { field: "title", op: "contains", value: "corp" },
      ],
    });
  });

  it("offers the whole deal catalog, Organization and Label included", () => {
    render(<DealFilterBuilder stages={STAGES} activeCount={0} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtro" }));
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    fireEvent.click(screen.getByLabelText("Campo da condição 1"));
    for (const label of [
      "Título",
      "Organização",
      "Valor",
      "Responsável",
      "Etapa",
      "Data prevista de fechamento",
      "Etiqueta",
    ]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("offers the merged label catalog as the value options for a Label condition", () => {
    render(<DealFilterBuilder stages={STAGES} activeCount={0} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtro" }));
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    fireEvent.click(screen.getByLabelText("Campo da condição 1"));
    fireEvent.click(screen.getByRole("option", { name: "Etiqueta" }));
    fireEvent.click(screen.getByLabelText("Valor da condição 1"));
    expect(screen.getByRole("option", { name: "Hot" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cold" })).toBeInTheDocument();
  });

  it("compiles two picked labels into one is-any-of condition", () => {
    const onApply = vi.fn();
    render(<DealFilterBuilder stages={STAGES} activeCount={0} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtro" }));
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    fireEvent.click(screen.getByLabelText("Campo da condição 1"));
    fireEvent.click(screen.getByRole("option", { name: "Etiqueta" }));
    fireEvent.click(screen.getByLabelText("Valor da condição 1"));
    fireEvent.click(screen.getByRole("option", { name: /^Hot$/ }));
    fireEvent.click(screen.getByRole("option", { name: /^Cold$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(onApply).toHaveBeenCalledWith({
      combinator: "and",
      conditions: [{ field: "labels", op: "eq", value: ["Hot", "Cold"] }],
    });
  });

  it("does not compile a label condition with nothing picked", () => {
    const onApply = vi.fn();
    render(<DealFilterBuilder stages={STAGES} activeCount={0} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtro" }));
    fireEvent.click(screen.getByRole("button", { name: /adicionar condição/i }));
    fireEvent.click(screen.getByLabelText("Campo da condição 1"));
    fireEvent.click(screen.getByRole("option", { name: "Etiqueta" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("clears the applied definition", () => {
    const onApply = vi.fn();
    render(<DealFilterBuilder stages={STAGES} activeCount={1} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtro" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(onApply).toHaveBeenCalledWith(null);
  });

  // Reopening a blank form misreports what the list is showing, and an "any of" filter reopened as
  // "all of" is silently rewritten on the next Apply.
  it("reopens on the applied conditions and combinator, not a blank form", () => {
    render(
      <DealFilterBuilder
        stages={STAGES}
        activeCount={2}
        onApply={vi.fn()}
        appliedDefinition={{
          combinator: "or",
          conditions: [
            { field: "title", op: "contains", value: "acme" },
            { field: "title", op: "contains", value: "corp" },
          ],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filtro" }));
    expect(screen.getAllByLabelText(/Campo da condição \d+/)).toHaveLength(2);
    expect(screen.getByLabelText<HTMLInputElement>("Valor da condição 1").value).toBe("acme");
    expect(screen.getByLabelText("Combinador de correspondência")).toHaveTextContent("qualquer condição");
  });

  it("opens blank when nothing is applied", () => {
    render(<DealFilterBuilder stages={STAGES} activeCount={0} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtro" }));
    expect(screen.queryAllByLabelText(/Campo da condição \d+/)).toHaveLength(0);
  });
});
