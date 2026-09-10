// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MessageTrackingHistory } from "./MessageTrackingHistory";

afterEach(() => {
  cleanup();
});

describe("MessageTrackingHistory", () => {
  it("renders an opened indicator for a message with two open events", () => {
    render(
      <MessageTrackingHistory
        tracking={[
          { type: "open", at: "2026-07-04T10:00:00.000Z" },
          { type: "open", at: "2026-07-04T09:00:00.000Z" },
        ]}
      />,
    );
    expect(screen.getByText("Aberto 2 vezes")).toBeInTheDocument();
  });

  it("renders both opened and clicked indicators when both event types are present", () => {
    render(
      <MessageTrackingHistory
        tracking={[
          { type: "open", at: "2026-07-04T10:00:00.000Z" },
          { type: "click", at: "2026-07-04T09:00:00.000Z" },
        ]}
      />,
    );
    expect(screen.getByText("Aberto 1 vez")).toBeInTheDocument();
    expect(screen.getByText("Clicado 1 vez")).toBeInTheDocument();
  });

  it("renders nothing for a message with no tracking history", () => {
    const { container } = render(<MessageTrackingHistory tracking={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
