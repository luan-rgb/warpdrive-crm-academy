// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

it("describes current progress without announcing every poll update", () => {
  render(<ProgressBar processed={25} total={100} />);

  expect(screen.getByRole("progressbar", { name: "Progresso da importação" })).toHaveAttribute(
    "aria-valuetext",
    "25 de 100 (25%)",
  );
  expect(screen.getByText("25 / 100 (25%)")).not.toHaveAttribute("aria-live");
});
