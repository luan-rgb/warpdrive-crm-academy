// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { HELP_TEXTS } from "@/constants/helpTexts";
import { HelpTooltip } from "./help-tooltip";

afterEach(cleanup);

describe("HelpTooltip", () => {
  it("is a small labelled button that reveals the explanation on click", async () => {
    const user = userEvent.setup();
    render(<HelpTooltip topic="deal.value" />);
    const trigger = screen.getByRole("button", {
      name: `Ajuda: ${HELP_TEXTS["deal.value"].title}`,
    });
    expect(screen.queryByText(HELP_TEXTS["deal.value"].body)).not.toBeInTheDocument();
    await user.click(trigger);
    expect(await screen.findByText(HELP_TEXTS["deal.value"].body)).toBeInTheDocument();
  });

  it("opens from the keyboard too", async () => {
    const user = userEvent.setup();
    render(<HelpTooltip topic="pipeline.board" />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByText(HELP_TEXTS["pipeline.board"].body)).toBeInTheDocument();
  });

  it("does not submit a surrounding form", async () => {
    const user = userEvent.setup();
    let submitted = false;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted = true;
        }}
      >
        <HelpTooltip topic="deal.value" />
      </form>,
    );
    await user.click(screen.getByRole("button"));
    expect(submitted).toBe(false);
  });
});
