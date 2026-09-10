// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { InboxFilter } from "./emailReads";
import { InboxAttributeFilters } from "./InboxAttributeFilters";
import { type AttributeFilterState, NO_ATTRIBUTE_FILTER } from "./threadAttributeFilter";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(cleanup);

const noop = (): void => {};

describe("InboxAttributeFilters", () => {
  it("renders a follow-up and a label filter", () => {
    render(<InboxAttributeFilters value={NO_ATTRIBUTE_FILTER} onChange={noop} />);
    expect(screen.getByLabelText("Filtro de status de acompanhamento")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtro de etiqueta")).toBeInTheDocument();
  });

  it("reflects the selected follow-up status", () => {
    render(
      <InboxAttributeFilters
        value={{ ...NO_ATTRIBUTE_FILTER, followUp: "waiting" }}
        onChange={noop}
      />,
    );
    expect(screen.getByLabelText("Filtro de status de acompanhamento")).toHaveTextContent(
      "Esperando",
    );
  });

  it("reflects the selected label", () => {
    render(
      <InboxAttributeFilters value={{ ...NO_ATTRIBUTE_FILTER, label: "to_do" }} onChange={noop} />,
    );
    expect(screen.getByLabelText("Filtro de etiqueta")).toHaveTextContent("A fazer");
  });

  it("renders the quick-filter controls", () => {
    render(<InboxAttributeFilters value={NO_ATTRIBUTE_FILTER} onChange={noop} />);
    expect(screen.getByLabelText("Tem anexo")).toBeInTheDocument();
    expect(screen.getByLabelText("Somente não lidas")).toBeInTheDocument();
    expect(screen.getByLabelText("Período")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpar" })).toBeInTheDocument();
  });

  it("toggling Has attachment calls onChange with hasAttachment true", () => {
    const onChange = vi.fn<(next: AttributeFilterState) => void>();
    render(<InboxAttributeFilters value={NO_ATTRIBUTE_FILTER} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Tem anexo"));
    expect(onChange).toHaveBeenCalledWith({ ...NO_ATTRIBUTE_FILTER, hasAttachment: true });
  });

  it("toggling Unread only calls onChange with unreadOnly true", () => {
    const onChange = vi.fn<(next: AttributeFilterState) => void>();
    render(<InboxAttributeFilters value={NO_ATTRIBUTE_FILTER} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Somente não lidas"));
    expect(onChange).toHaveBeenCalledWith({ ...NO_ATTRIBUTE_FILTER, unreadOnly: true });
  });

  it("reflects the selected date range", () => {
    render(
      <InboxAttributeFilters value={{ ...NO_ATTRIBUTE_FILTER, dateRange: "7d" }} onChange={noop} />,
    );
    expect(screen.getByLabelText("Período")).toHaveTextContent("Últimos 7 dias");
  });

  it("renders the quick-filter dropdown trigger (shadcn, not a native select)", () => {
    render(<InboxAttributeFilters value={NO_ATTRIBUTE_FILTER} onChange={noop} />);
    const trigger = screen.getByRole("button", { name: "Mais filtros" });
    expect(trigger).toBeInTheDocument();
    // No native <select> anywhere in the control (design-system hard rule).
    expect(document.querySelector("select")).toBeNull();
  });

  it("opens the dropdown and lists the new server-side filter options", async () => {
    const user = userEvent.setup();
    render(<InboxAttributeFilters value={NO_ATTRIBUTE_FILTER} onChange={noop} />);
    await user.click(screen.getByRole("button", { name: "Mais filtros" }));
    for (const label of [
      "Compartilhados",
      "Privados",
      "E-mails rastreados",
      "Para: mim",
      "De um contato existente",
      "Vinculados a um negócio aberto",
    ]) {
      expect(await screen.findByRole("menuitemradio", { name: label })).toBeInTheDocument();
    }
  });

  it("selecting a quick-filter option calls onQuickFilterChange with that filter", async () => {
    const user = userEvent.setup();
    const onQuickFilterChange = vi.fn<(next: InboxFilter) => void>();
    render(
      <InboxAttributeFilters
        value={NO_ATTRIBUTE_FILTER}
        onChange={noop}
        quickFilter="all"
        onQuickFilterChange={onQuickFilterChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Mais filtros" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Compartilhados" }));
    expect(onQuickFilterChange).toHaveBeenCalledWith("shared");
  });

  it("reflects the active quick-filter as the checked radio option", async () => {
    const user = userEvent.setup();
    render(
      <InboxAttributeFilters
        value={NO_ATTRIBUTE_FILTER}
        onChange={noop}
        quickFilter="tracked"
        onQuickFilterChange={noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Mais filtros" }));
    expect(
      await screen.findByRole("menuitemradio", { name: "E-mails rastreados" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("Clear resets to NO_ATTRIBUTE_FILTER", () => {
    const onChange = vi.fn<(next: AttributeFilterState) => void>();
    render(
      <InboxAttributeFilters
        value={{ ...NO_ATTRIBUTE_FILTER, hasAttachment: true, unreadOnly: true, dateRange: "30d" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(onChange).toHaveBeenCalledWith(NO_ATTRIBUTE_FILTER);
  });

  // Regression (codex review): Clear previously reset only the client-side attribute filters,
  // leaving the server-side quick-filter active so the list stayed narrowed. Clear must reset both.
  it("Clear also resets the quick filter to all", () => {
    const onQuickFilterChange = vi.fn<(next: InboxFilter) => void>();
    render(
      <InboxAttributeFilters
        value={{ ...NO_ATTRIBUTE_FILTER, unreadOnly: true }}
        onChange={noop}
        quickFilter="private"
        onQuickFilterChange={onQuickFilterChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(onQuickFilterChange).toHaveBeenCalledWith("all");
  });
});
