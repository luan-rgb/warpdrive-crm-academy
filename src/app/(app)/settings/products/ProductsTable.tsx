"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import type { Product } from "@/db/schema/products";
import { archiveProductAction } from "@/features/products/actions";
import { readCsrfToken } from "@/utils/csrfCookie";

const S = SETTINGS_STRINGS;

function priceText(price: string): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(price));
}

interface Props {
  products: Product[];
  onChanged: () => void;
  onEdit: (product: Product) => void;
}

export function ProductsTable({ products, onChanged, onEdit }: Props): React.ReactElement {
  const [pendingArchive, setPendingArchive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function confirmArchive(): void {
    const id = pendingArchive;
    if (id === null) return;
    setPendingArchive(null);
    setError(null);
    startTransition(async () => {
      const r = await archiveProductAction({ id }, readCsrfToken());
      if (!r.ok) {
        setError(S.productSaveFailed);
        return;
      }
      onChanged();
    });
  }

  if (products.length === 0) {
    return <p className="text-sm text-muted-foreground">{S.productsEmpty}</p>;
  }

  return (
    <>
      {error !== null && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">{S.productName}</th>
            <th className="px-3 py-2">{S.productSku}</th>
            <th className="px-3 py-2">{S.productPrice}</th>
            <th className="px-3 py-2">{S.productUnit}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className={`border-t ${p.isArchived ? "opacity-50" : ""}`}>
              <td className="px-3 py-2">{p.name}</td>
              <td className="px-3 py-2">{p.sku ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums">{priceText(p.price)}</td>
              <td className="px-3 py-2">{p.unit}</td>
              <td className="px-3 py-2 text-right">
                {!p.isArchived && (
                  <span className="inline-flex gap-1">
                    <Button variant="ghost" onClick={() => onEdit(p)}>
                      {S.productEdit}
                    </Button>
                    <Button variant="ghost" onClick={() => setPendingArchive(p.id)}>
                      {S.productArchive}
                    </Button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={pendingArchive !== null}
        onOpenChange={(open) => {
          if (!open) setPendingArchive(null);
        }}
        title={S.productArchive}
        description={S.productArchiveConfirm}
        confirmLabel={S.productArchive}
        destructive
        onConfirm={confirmArchive}
      />
    </>
  );
}
