// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WizardStepper } from "./WizardStepper";

afterEach(cleanup);

describe("WizardStepper", () => {
  it("renders all four step labels in order", () => {
    render(<WizardStepper step="upload" />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Enviar"),
      expect.stringContaining("Mapear colunas"),
      expect.stringContaining("Pré-visualizar"),
      expect.stringContaining("Importar"),
    ]);
  });

  it("marks the active step with aria-current", () => {
    render(<WizardStepper step="map" />);
    const current = screen.getByRole("listitem", { current: "step" });
    expect(current.textContent).toContain("Mapear colunas");
  });

  it("keeps the active step on the parent step while a background phase runs", () => {
    // validating is a background phase of Map columns, so the stepper must stay on Map columns.
    render(<WizardStepper step="validating" />);
    expect(screen.getByRole("listitem", { current: "step" }).textContent).toContain(
      "Mapear colunas",
    );
  });

  it("marks steps before the active one as complete", () => {
    render(<WizardStepper step="preview" />);
    const states = screen.getAllByRole("listitem").map((li) => li.getAttribute("data-state"));
    // Upload and Map columns precede Preview, so both carry the completed flag.
    expect(states).toEqual(["complete", "complete", "current", "upcoming"]);
  });
});
