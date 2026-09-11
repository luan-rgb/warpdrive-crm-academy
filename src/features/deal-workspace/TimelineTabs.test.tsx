// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineTabs } from "./TimelineTabs";

afterEach(cleanup);

describe("TimelineTabs", () => {
  it("renders a Focus and a History tab", () => {
    render(
      <TimelineTabs view="history" onView={() => {}}>
        <p>content</p>
      </TimelineTabs>,
    );
    expect(screen.getByRole("tab", { name: "Foco" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Histórico" })).toBeInTheDocument();
  });

  it("marks the active view as aria-selected", () => {
    render(
      <TimelineTabs view="history" onView={() => {}}>
        <p>content</p>
      </TimelineTabs>,
    );
    expect(screen.getByRole("tab", { name: "Histórico" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Foco" })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onView with 'focus' when the Focus tab is clicked", async () => {
    const onView = vi.fn();
    render(
      <TimelineTabs view="history" onView={onView}>
        <p>content</p>
      </TimelineTabs>,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Foco" }));
    expect(onView).toHaveBeenCalledWith("focus");
  });

  it("calls onView with 'history' when the History tab is clicked", async () => {
    const onView = vi.fn();
    render(
      <TimelineTabs view="focus" onView={onView}>
        <p>content</p>
      </TimelineTabs>,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Histórico" }));
    expect(onView).toHaveBeenCalledWith("history");
  });

  it("renders children below the tab switch", () => {
    render(
      <TimelineTabs view="focus" onView={() => {}}>
        <p>Nada precisa da sua atenção</p>
      </TimelineTabs>,
    );
    expect(screen.getByText("Nada precisa da sua atenção")).toBeInTheDocument();
  });
});
