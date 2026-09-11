// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Organization, Person } from "@/db/schema";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

const byDealData = [
  {
    id: "line-1",
    dealId: "deal-1",
    productId: "prod-1",
    name: "Widget",
    quantity: "2",
    unitPrice: "100.00",
    discountPercent: "0",
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    products: {
      byDeal: { useQuery: () => ({ data: byDealData }) },
    },
  },
}));

const { createInvoiceAction } = vi.hoisted(() => ({
  createInvoiceAction: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
}));
vi.mock("./actions", () => ({ createInvoiceAction }));

import { CreateInvoiceDialog } from "./CreateInvoiceDialog";

const org: Organization = {
  id: "org-1",
  name: "Acme Inc",
  address: { street: "1 Main St", city: "Springfield" },
  domain: null,
  industry: null,
  employeeCount: null,
  annualRevenue: null,
  linkedinUrl: null,
  ownerId: "user-1",
  visibilityLevel: "all",
  visibilityGroupId: null,
  visibleToUserIds: [],
  labels: [],
  customFields: {},
  searchTsv: "",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const person: Person = {
  id: "person-1",
  name: "Jane Doe",
  firstName: "Jane",
  lastName: "Doe",
  primaryEmail: "jane@acme.com",
  emails: [],
  phones: [],
  orgId: "org-1",
  ownerId: "user-1",
  visibilityLevel: "all",
  visibilityGroupId: null,
  visibleToUserIds: [],
  labels: [],
  customFields: {},
  searchTsv: "",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

it("prefills customer details from the deal's org and person", () => {
  render(
    <CreateInvoiceDialog
      dealId="deal-1"
      org={org}
      person={person}
      baseCurrency="USD"
      open
      onOpenChange={() => {}}
      onCreated={() => {}}
    />,
  );
  expect(screen.getByLabelText("Nome do cliente")).toHaveValue("Acme Inc");
  expect(screen.getByLabelText("Email do cliente")).toHaveValue("jane@acme.com");
  expect(screen.getByLabelText("Endereço do cliente")).toHaveValue("1 Main St, Springfield");
});

it("shows a running subtotal/tax/total that updates when a line's tax rate changes", async () => {
  render(
    <CreateInvoiceDialog
      dealId="deal-1"
      org={org}
      person={person}
      baseCurrency="USD"
      open
      onOpenChange={() => {}}
      onCreated={() => {}}
    />,
  );
  // base: 2 * 100.00 = 200.00, tax rate starts at 0
  expect(screen.getByTestId("create-invoice-subtotal")).toHaveTextContent("US$ 200,00");
  expect(screen.getByTestId("create-invoice-tax-total")).toHaveTextContent("US$ 0,00");

  const taxInput = screen.getByLabelText("Imposto % de Widget");
  fireEvent.change(taxInput, { target: { value: "10" } });

  await waitFor(() => {
    expect(screen.getByTestId("create-invoice-tax-total")).toHaveTextContent("US$ 20,00");
    expect(screen.getByTestId("create-invoice-total")).toHaveTextContent("US$ 220,00");
  });
});

it("sends an explicit empty string, not null, when the user clears a prefilled bill-to field", async () => {
  render(
    <CreateInvoiceDialog
      dealId="deal-1"
      org={org}
      person={person}
      baseCurrency="USD"
      open
      onOpenChange={() => {}}
      onCreated={() => {}}
    />,
  );
  const nameInput = screen.getByLabelText("Nome do cliente");
  expect(nameInput).toHaveValue("Acme Inc");
  fireEvent.change(nameInput, { target: { value: "" } });

  screen.getByRole("button", { name: "Criar fatura" }).click();
  await waitFor(() => expect(createInvoiceAction).toHaveBeenCalled());
  const [input] = createInvoiceAction.mock.calls[0]! as unknown as [Record<string, unknown>];
  // Deliberately cleared by the user: must NOT be null, which the repo treats as "not supplied"
  // and falls back to the org's name, silently discarding the user's edit.
  expect(input.billToName).toBe("");
});

it("submits the bill-to fields, tax mode, and per-line tax rates on create", async () => {
  const onCreated = vi.fn();
  render(
    <CreateInvoiceDialog
      dealId="deal-1"
      org={org}
      person={person}
      baseCurrency="USD"
      open
      onOpenChange={() => {}}
      onCreated={onCreated}
    />,
  );
  screen.getByRole("button", { name: "Criar fatura" }).click();
  await waitFor(() => expect(createInvoiceAction).toHaveBeenCalled());
  const [input] = createInvoiceAction.mock.calls[0]! as unknown as [Record<string, unknown>];
  expect(input.dealId).toBe("deal-1");
  expect(input.billToName).toBe("Acme Inc");
  expect(input.billToEmail).toBe("jane@acme.com");
  expect(input.taxMode).toBe("exclusive");
  expect(input.lineTaxRates).toEqual(["0"]);
  expect(onCreated).toHaveBeenCalled();
});
