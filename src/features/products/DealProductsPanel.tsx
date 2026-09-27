// DealProductsPanel: line items (products) attached to one deal. Reused by the deal
// workspace's Products history tab. Lists trpc products.byDeal, an "Add product" row backed
// by the catalog (trpc products.list), and per-line quantity/discount editing.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatCurrencyExact } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { addDealProductAction, removeDealProductAction, updateDealProductAction } from "./actions";

// Tenants run in BRL (settings.base_currency), the helper's default.
function money(v: string | number): string {
  return formatCurrencyExact(v);
}

function lineTotal(quantity: string, unitPrice: string, discountPercent: string): number {
  return Number(quantity) * Number(unitPrice) * (1 - Number(discountPercent) / 100);
}

export function DealProductsPanel({ dealId }: { dealId: string }): React.ReactNode {
  const router = useRouter();
  const utils = trpc.useUtils();
  const linesQuery = trpc.products.byDeal.useQuery({ dealId });
  const catalogQuery = trpc.products.list.useQuery({ includeArchived: false });
  const lines = linesQuery.data ?? [];
  const catalog = catalogQuery.data ?? [];

  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState<string | null>(null);

  function refresh(): void {
    void utils.products.byDeal.invalidate({ dealId });
    // A line-item change can move deals.value (syncDealValue), which the deal header and
    // Summary section render from the server-fetched workspace, not from this tRPC cache.
    router.refresh();
  }

  async function addLine(): Promise<void> {
    setError(null);
    if (selectedProductId === "") return;
    const r = await addDealProductAction(
      { dealId, productId: selectedProductId, quantity, discountPercent: "0" },
      readCsrfToken(),
    );
    if (!r.ok) {
      setError("Não foi possível adicionar o produto a este negócio.");
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
    const r = await updateDealProductAction({ id, ...next }, readCsrfToken());
    if (!r.ok) {
      setError("Não foi possível atualizar este item.");
      return;
    }
    refresh();
  }

  async function removeLine(id: string): Promise<void> {
    const r = await removeDealProductAction({ id }, readCsrfToken());
    if (!r.ok) {
      setError("Não foi possível remover este item.");
      return;
    }
    refresh();
  }

  const total = lines.reduce(
    (sum, l) => sum + lineTotal(l.quantity, l.unitPrice, l.discountPercent),
    0,
  );

  return (
    <div className="space-y-4">
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ainda não há produtos neste negócio.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2">Qtd.</th>
              <th className="px-3 py-2">Preço unit.</th>
              <th className="px-3 py-2">Desconto %</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2">{l.name}</td>
                <td className="px-3 py-2 w-20">
                  <Input
                    aria-label="Quantidade"
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
                <td className="px-3 py-2 w-28">
                  <Input
                    aria-label="Preço unitário"
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
                <td className="px-3 py-2 w-24">
                  <Input
                    aria-label="Percentual de desconto"
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
                <td className="px-3 py-2 tabular-nums">
                  {money(lineTotal(l.quantity, l.unitPrice, l.discountPercent))}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" onClick={() => void removeLine(l.id)}>
                    Remover
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold">
              <td className="px-3 py-2" colSpan={4}>
                Total
              </td>
              <td className="px-3 py-2 tabular-nums">{money(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}

      <div className="flex items-end gap-2">
        <div className="min-w-48">
          <Select
            ariaLabel="Produto"
            value={selectedProductId}
            onChange={setSelectedProductId}
            options={[
              { value: "", label: "Selecione um produto" },
              ...catalog.map((p) => ({ value: p.id, label: `${p.name} (${money(p.price)})` })),
            ]}
          />
        </div>
        <div className="w-20">
          <Input
            aria-label="Quantidade"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <Button onClick={() => void addLine()} disabled={selectedProductId === ""}>
          Adicionar produto
        </Button>
      </div>
    </div>
  );
}
