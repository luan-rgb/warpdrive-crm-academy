// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserStatusTabs } from "./UserStatusTabs";

afterEach(cleanup);

describe("UserStatusTabs", () => {
  it("renders the filters as a named toggle-button group", () => {
    render(<UserStatusTabs value="all" onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Filtro de status do usuário" })).toBeInTheDocument();
    for (const name of ["Todos", "Ativos", "Convidados", "Desativados"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("marks the active filter pressed without dangling tab-panel references", () => {
    render(<UserStatusTabs value="invited" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Convidados" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Ativos" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Convidados" })).not.toHaveAttribute(
      "aria-controls",
    );
  });

  it("reports the clicked status", async () => {
    const onChange = vi.fn();
    render(<UserStatusTabs value="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Desativados" }));
    expect(onChange).toHaveBeenCalledWith("deactivated");
  });
});
