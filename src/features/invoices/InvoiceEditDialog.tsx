// InvoiceEditDialog: add/edit/remove line items on an already-issued invoice. Locked once the
// invoice is paid or canceled (assertEditable on the server is the real gate; this dialog only
// opens for an "issued" invoice, per InvoicesPanel).

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  addInvoiceLineItemAction,
  removeInvoiceLineItemAction,
  updateInvoiceLineItemAction,
} from "./actions";

function money(v: string | number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v));
}

function lineTotal(quantity: string, unitPrice: string, discountPercent: string): number {
  return Number(quantity) * Number(unitPrice) * (1 - Number(discountPercent) / 100);
}

export function InvoiceEditDialog({
  invoiceId,
  open,
  onOpenChange,
  onChanged,
}: {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}): React.ReactNode {
  const invoiceQuery = trpc.invoices.get.useQuery({ id: invoiceId }, { enabled: open });
  const catalogQuery = trpc.products.list.useQuery({ includeArchived: false });
  const lines = invoiceQuery.data?.lines ?? [];
  const catalog = catalogQuery.data ?? [];

  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState<string | null>(null);

  function refresh(): void {
    void invoiceQuery.refetch();
    onChanged();
  }

  async function addLine(): Promise<void> {
    setError(null);
    if (selectedProductId === "") return;
    const r = await addInvoiceLineItemAction(
      { invoiceId, productId: selectedProductId, quantity, discountPercent: "0" },
      readCsrfToken(),
    );
    if (!r.ok) {
      setError("Could not add the item.");
      return;
    }
    setSelectedProductId("");
    setQuantity("1");
    refresh();
  }

  async function updateLine(
    id: string,
    next: { quantity: string; unitPrice: string; discountPercent: string },
  ): Promise<void> {
    const r = await updateInvoiceLineItemAction({ id, ...next }, readCsrfToken());
    if (!r.ok) {
      setError("Could not update this item.");
      return;
    }
    refresh();
  }

  async function removeLine(id: string): Promise<void> {
    const r = await removeInvoiceLineItemAction({ id }, readCsrfToken());
    if (!r.ok) {
      setError("Could not remove this item.");
      return;
    }
    refresh();
  }

  const total = lines.reduce(
    (sum, l) => sum + lineTotal(l.quantity, l.unitPrice, l.discountPercent),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit invoice</DialogTitle>
        </DialogHeader>

        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No line items yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Item</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Unit price</th>
                <th className="px-2 py-2">Discount %</th>
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-2 py-2">{l.name}</td>
                  <td className="px-2 py-2 w-20">
                    <Input
                      aria-label="Quantity"
                      value={l.quantity}
                      onChange={(e) =>
                        void updateLine(l.id, {
                          quantity: e.target.value,
                          unitPrice: l.unitPrice,
                          discountPercent: l.discountPercent,
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-2 w-28">
                    <Input
                      aria-label="Unit price"
                      value={l.unitPrice}
                      onChange={(e) =>
                        void updateLine(l.id, {
                          quantity: l.quantity,
                          unitPrice: e.target.value,
                          discountPercent: l.discountPercent,
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-2 w-24">
                    <Input
                      aria-label="Discount percent"
                      value={l.discountPercent}
                      onChange={(e) =>
                        void updateLine(l.id, {
                          quantity: l.quantity,
                          unitPrice: l.unitPrice,
                          discountPercent: e.target.value,
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {money(lineTotal(l.quantity, l.unitPrice, l.discountPercent))}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button variant="ghost" onClick={() => void removeLine(l.id)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="px-2 py-2" colSpan={4}>
                  Total
                </td>
                <td className="px-2 py-2 tabular-nums">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}

        <div className="flex items-end gap-2">
          <div className="min-w-48">
            <Select
              ariaLabel="Product"
              value={selectedProductId}
              onChange={setSelectedProductId}
              options={[
                { value: "", label: "Select a product" },
                ...catalog.map((p) => ({ value: p.id, label: `${p.name} (${money(p.price)})` })),
              ]}
            />
          </div>
          <div className="w-20">
            <Input
              aria-label="Quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <Button onClick={() => void addLine()} disabled={selectedProductId === ""}>
            Add item
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
