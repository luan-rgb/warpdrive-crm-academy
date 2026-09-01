"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { Textarea } from "@/components/ui/Textarea";
import type { Organization, Person } from "@/db/schema";
import type { InvoiceTaxMode } from "@/db/schema/invoices";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { createInvoiceAction } from "./actions";

const ADDRESS_KEYS = ["street", "city", "region", "postal", "country"] as const;
function formatAddress(address: Record<string, unknown> | null): string {
  if (address === null) return "";
  const parts = ADDRESS_KEYS.map((key) => address[key]).filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  return parts.join(", ");
}

function money(v: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function lineBase(quantity: string, unitPrice: string): number {
  return Number(quantity) * Number(unitPrice);
}

const TAX_MODE_LABEL: Record<InvoiceTaxMode, string> = {
  exclusive: "Tax exclusive",
  inclusive: "Tax inclusive",
  none: "No tax",
};

export function CreateInvoiceDialog({
  dealId,
  org,
  person,
  baseCurrency,
  open,
  onOpenChange,
  onCreated,
}: {
  dealId: string;
  org: Organization | null;
  person: Person | null;
  baseCurrency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}): React.ReactNode {
  const dealProductsQuery = trpc.products.byDeal.useQuery({ dealId });
  const dealLines = dealProductsQuery.data ?? [];

  const [billToName, setBillToName] = useState(org?.name ?? person?.name ?? "");
  const [billToAddress, setBillToAddress] = useState(formatAddress(org?.address ?? null));
  const [billToEmail, setBillToEmail] = useState(person?.primaryEmail ?? "");
  const [billToTaxId, setBillToTaxId] = useState("");
  const [taxMode, setTaxMode] = useState<InvoiceTaxMode>("exclusive");
  const [issueDate, setIssueDate] = useState<string | null>(
    new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [taxRates, setTaxRates] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function taxRateFor(lineId: string): string {
    return taxRates[lineId] ?? "0";
  }

  const totals = useMemo(() => {
    let base = 0;
    let tax = 0;
    for (const line of dealLines) {
      const b = lineBase(line.quantity, line.unitPrice) * (1 - Number(line.discountPercent) / 100);
      const rate = Number(taxRateFor(line.id)) / 100;
      const lineTax = taxMode === "none" ? 0 : taxMode === "inclusive" ? b - b / (1 + rate) : b * rate;
      base += b;
      tax += lineTax;
    }
    const subtotal = taxMode === "inclusive" ? base - tax : base;
    const total = taxMode === "inclusive" ? base : base + tax;
    return { subtotal, tax, total };
  }, [dealLines, taxRates, taxMode]);

  async function submit(): Promise<void> {
    setError(null);
    setPending(true);
    const r = await createInvoiceAction(
      {
        dealId,
        issueDate: issueDate ?? new Date().toISOString().slice(0, 10),
        dueDate,
        notes: notes.trim() === "" ? null : notes,
        taxMode,
        billToName: billToName.trim() === "" ? null : billToName,
        billToAddress: billToAddress.trim() === "" ? null : billToAddress,
        billToEmail: billToEmail.trim() === "" ? null : billToEmail,
        billToTaxId: billToTaxId.trim() === "" ? null : billToTaxId,
        lineTaxRates: dealLines.map((l) => taxRateFor(l.id)),
      },
      readCsrfToken(),
    );
    setPending(false);
    if (!r.ok) {
      setError(
        r.error.id === "E_INVOICE_004"
          ? "This deal has no products to invoice yet."
          : "Could not create the invoice.",
      );
      return;
    }
    onCreated();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
        </DialogHeader>

        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Customer details</h3>
            <Input
              aria-label="Customer name"
              placeholder="Name"
              value={billToName}
              onChange={(e) => setBillToName(e.target.value)}
            />
            <Input
              aria-label="Customer address"
              placeholder="Address"
              value={billToAddress}
              onChange={(e) => setBillToAddress(e.target.value)}
            />
            <Input
              aria-label="Customer email"
              placeholder="Email"
              value={billToEmail}
              onChange={(e) => setBillToEmail(e.target.value)}
            />
            <Input
              aria-label="Customer tax ID"
              placeholder="Tax ID"
              value={billToTaxId}
              onChange={(e) => setBillToTaxId(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Invoice details</h3>
            <RadioGroup
              value={taxMode}
              onValueChange={(v) => setTaxMode(v as InvoiceTaxMode)}
              className="flex flex-col gap-1.5"
            >
              {(["exclusive", "inclusive", "none"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={mode} id={`tax-mode-${mode}`} />
                  {TAX_MODE_LABEL[mode]}
                </label>
              ))}
            </RadioGroup>
            <DatePicker value={issueDate} onChange={setIssueDate} ariaLabel="Issue date" />
            <DatePicker value={dueDate} onChange={setDueDate} ariaLabel="Due date" />
            <Textarea
              aria-label="Notes"
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit price</th>
              {taxMode !== "none" && <th className="py-2 text-right">Tax %</th>}
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {dealLines.map((line) => (
              <tr key={line.id} className="border-t">
                <td className="py-2">{line.name}</td>
                <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                <td className="py-2 text-right tabular-nums">
                  {money(Number(line.unitPrice), baseCurrency)}
                </td>
                {taxMode !== "none" && (
                  <td className="py-2 w-24">
                    <Input
                      aria-label={`Tax % for ${line.name}`}
                      value={taxRateFor(line.id)}
                      onChange={(e) =>
                        setTaxRates((prev) => ({ ...prev, [line.id]: e.target.value }))
                      }
                    />
                  </td>
                )}
                <td className="py-2 text-right tabular-nums">
                  {money(
                    lineBase(line.quantity, line.unitPrice) * (1 - Number(line.discountPercent) / 100),
                    baseCurrency,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-col items-end gap-1 text-sm">
          <p>
            Subtotal:{" "}
            <span data-testid="create-invoice-subtotal" className="tabular-nums font-medium">
              {money(totals.subtotal, baseCurrency)}
            </span>
          </p>
          {taxMode !== "none" && (
            <p>
              Tax:{" "}
              <span data-testid="create-invoice-tax-total" className="tabular-nums font-medium">
                {money(totals.tax, baseCurrency)}
              </span>
            </p>
          )}
          <p className="font-semibold">
            Total:{" "}
            <span data-testid="create-invoice-total" className="tabular-nums">
              {money(totals.total, baseCurrency)}
            </span>
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || dealLines.length === 0}>
            Create invoice
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
