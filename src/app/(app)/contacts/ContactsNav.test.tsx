// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/contacts/people/person-1" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ContactsNav } from "./ContactsNav";

afterEach(cleanup);

describe("ContactsNav", () => {
  it("uses the Settings secondary-navigation icon and active-state treatment", () => {
    render(<ContactsNav />);

    for (const label of ["Pessoas", "Organizações", "Linha do tempo"]) {
      expect(screen.getByRole("link", { name: label }).querySelector("svg")).not.toBeNull();
    }

    const active = screen.getByRole("link", { name: "Pessoas" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveClass("bg-blue-50", "font-semibold", "text-blue-700");

    const idle = screen.getByRole("link", { name: "Organizações" });
    expect(idle).toHaveClass("font-normal", "text-foreground");
  });

  it("uses the same rail width as Settings navigation", () => {
    render(<ContactsNav />);
    expect(screen.getByRole("navigation", { name: "Seções de contatos" })).toHaveClass("w-56");
  });
});
