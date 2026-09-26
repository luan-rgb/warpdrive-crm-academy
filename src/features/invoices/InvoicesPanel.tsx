// InvoicesPanel: invoices issued for one deal, shown in the deal Summary sidebar. "Create
// invoice" opens CreateInvoiceDialog, prefilled from the deal's org/person and current products
// (features/products/DealProductsPanel is the source of truth for what gets billed); each row
// links to the printable invoice page.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import type { Organization, Person } from "@/db/schema";
import { formatCurrencyExact } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { deleteInvoiceAction, updateInvoiceStatusAction } from "./actions";
import { CreateInvoiceDialog } from "./CreateInvoiceDialog";
import { InvoiceEditDialog } from "./InvoiceEditDialog";

function money(v: string, currency: string): string {
  return formatCurrencyExact(v, currency);
}

function invoiceNumber(sequenceNumber: number): string {
  return `INV-${String(sequenceNumber).padStart(4, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  issued: "Emitida",
  paid: "Paga",
  canceled: "Cancelada",
};

export function InvoicesPanel({
  dealId,
  org,
  person,
  baseCurrency,
}: {
  dealId: string;
  org: Organization | null;
  person: Person | null;
  baseCurrency: string;
}): React.ReactNode {
  const router = useRouter();
  const utils = trpc.useUtils();
  const invoicesQuery = trpc.invoices.listForDeal.useQuery({ dealId });
  const invoices = invoicesQuery.data ?? [];
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function refresh(): void {
    void utils.invoices.listForDeal.invalidate({ dealId });
    router.refresh();
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
    setError("Não foi possível excluir a fatura.");
  }

  return (
    <div className="space-y-3">
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ainda não há faturas.</p>
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
              <span className="tabular-nums">{money(inv.total, baseCurrency)}</span>
              <span className="text-muted-foreground">
                {STATUS_LABEL[inv.status] ?? inv.status}
              </span>
              <span className="inline-flex gap-1">
                {inv.status === "issued" && (
                  <>
                    <Button variant="ghost" onClick={() => setEditing(inv.id)}>
                      Editar
                    </Button>
                    <Button variant="ghost" onClick={() => void markPaid(inv.id)}>
                      Marcar como paga
                    </Button>
                    <Button variant="ghost" onClick={() => void cancel(inv.id)}>
                      Cancelar
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={() => setPendingDelete(inv.id)}>
                  Excluir
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={() => setCreating(true)}>Gerar fatura</Button>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir fatura"
        description="Isso exclui permanentemente a fatura e seus itens. Essa ação não pode ser desfeita."
        confirmLabel="Excluir"
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
          baseCurrency={baseCurrency}
        />
      )}
      {creating && (
        <CreateInvoiceDialog
          dealId={dealId}
          org={org}
          person={person}
          baseCurrency={baseCurrency}
          open={creating}
          onOpenChange={setCreating}
          onCreated={refresh}
        />
      )}
    </div>
  );
}
