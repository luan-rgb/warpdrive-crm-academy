// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("./actions", () => ({
  addInvoiceLineItemAction: vi.fn(),
  removeInvoiceLineItemAction: vi.fn(),
  updateInvoiceLineItemAction: vi.fn(),
}));

const invoiceData = {
  invoice: { id: "inv-1", taxMode: "exclusive" },
  lines: [
    {
      id: "line-1",
      invoiceId: "inv-1",
      name: "Widget",
      quantity: "2",
      unitPrice: "100.00",
      discountPercent: "0",
      taxRatePercent: "10",
      position: 0,
    },
  ],
};

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    invoices: { get: { useQuery: () => ({ data: invoiceData, refetch: () => {} }) } },
    products: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

import { InvoiceEditDialog } from "./InvoiceEditDialog";

it("shows a tax % input per line and a subtotal/tax/total footer", () => {
  render(
    <InvoiceEditDialog
      invoiceId="inv-1"
      open
      onOpenChange={() => {}}
      onChanged={() => {}}
      baseCurrency="USD"
    />,
  );
  expect(screen.getByLabelText("Tax percent")).toHaveValue("10");
  // base 200.00, 10% tax = 20.00, total 220.00
  // Note: $200.00 appears in both line item total and subtotal, so check for multiple
  expect(screen.queryAllByText("$200.00").length).toBeGreaterThan(0);
  expect(screen.getByText("$20.00")).toBeInTheDocument();
  expect(screen.getByText("$220.00")).toBeInTheDocument();
});
