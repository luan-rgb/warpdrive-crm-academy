// InvoicesPanel: invoices issued for one deal, shown in the deal Summary sidebar. "Generate
// invoice" snapshots the deal's current products (features/products/DealProductsPanel is the
// source of truth for what gets billed); each row links to the printable invoice page.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { createInvoiceAction, deleteInvoiceAction, updateInvoiceStatusAction } from "./actions";
import { InvoiceEditDialog } from "./InvoiceEditDialog";

function money(v: string): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v));
}

function invoiceNumber(sequenceNumber: number): string {
  return `INV-${String(sequenceNumber).padStart(4, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  issued: "Issued",
  paid: "Paid",
  canceled: "Canceled",
};

export function InvoicesPanel({ dealId }: { dealId: string }): React.ReactNode {
  const router = useRouter();
  const utils = trpc.useUtils();
  const invoicesQuery = trpc.invoices.listForDeal.useQuery({ dealId });
  const invoices = invoicesQuery.data ?? [];
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  function refresh(): void {
    void utils.invoices.listForDeal.invalidate({ dealId });
    router.refresh();
  }

  async function generate(): Promise<void> {
    setError(null);
    setPending(true);
    const r = await createInvoiceAction(
      {
        dealId,
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: null,
        notes: null,
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
    refresh();
  }

  async function markPaid(id: string): Promise<void> {
    const r = await updateInvoiceStatusAction({ id, status: "paid" }, readCsrfToken());
    if (r.ok) refresh();
  }

  async function cancel(id: string): Promise<void> {
    const r = await updateInvoiceStatusAction({ id, status: "canceled" }, readCsrfToken());
    if (r.ok) refresh();
  }

  async function confirmDelete(): Promise<void> {
    const id = pendingDelete;
    if (id === null) return;
    setPendingDelete(null);
    const r = await deleteInvoiceAction({ id }, readCsrfToken());
    if (r.ok) {
      refresh();
      return;
    }
    setError("Could not delete the invoice.");
  }

  return (
    <div className="space-y-3">
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {invoices.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-2">
              <a
                href={`/invoices/${inv.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {invoiceNumber(inv.sequenceNumber)}
              </a>
              <span className="tabular-nums">{money(inv.total)}</span>
              <span className="text-muted-foreground">
                {STATUS_LABEL[inv.status] ?? inv.status}
              </span>
              <span className="inline-flex gap-1">
                {inv.status === "issued" && (
                  <>
                    <Button variant="ghost" onClick={() => setEditing(inv.id)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void markPaid(inv.id)}>
                      Mark paid
                    </Button>
                    <Button variant="ghost" onClick={() => void cancel(inv.id)}>
                      Cancel
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={() => setPendingDelete(inv.id)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={() => void generate()} disabled={pending}>
        Generate invoice
      </Button>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete invoice"
        description="This permanently deletes the invoice and its line items. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
      />
      {editing !== null && (
        <InvoiceEditDialog
          invoiceId={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
