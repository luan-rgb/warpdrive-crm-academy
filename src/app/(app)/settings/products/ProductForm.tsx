"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import type { Product } from "@/db/schema/products";

const S = SETTINGS_STRINGS;

export interface ProductDraft {
  name: string;
  sku: string | null;
  price: string;
  unit: string;
  description: string | null;
}

interface Props {
  // Present when editing; the same form serves both so create and edit cannot drift apart.
  initial?: Product;
  submitLabel: string;
  onSubmit: (draft: ProductDraft) => Promise<{ ok: boolean; errorId?: string }>;
  onDone: () => void;
}

export function ProductForm({ initial, submitLabel, onSubmit, onDone }: Props): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [price, setPrice] = useState(initial?.price ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "un");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await onSubmit({
        name: name.trim(),
        sku: sku.trim() === "" ? null : sku.trim(),
        price: price.trim(),
        unit: unit.trim() === "" ? "un" : unit.trim(),
        description: description.trim() === "" ? null : description.trim(),
      });
      if (!r.ok) {
        setError(
          r.errorId === "E_PRODUCT_003"
            ? S.productSkuExists
            : r.errorId === "E_PRODUCT_001"
              ? S.productInvalid
              : S.productSaveFailed,
        );
        return;
      }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Input
        aria-label={S.productName}
        placeholder={S.productName}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        aria-label={S.productSku}
        placeholder={S.productSku}
        value={sku}
        onChange={(e) => setSku(e.target.value)}
      />
      <Input
        aria-label={S.productPrice}
        placeholder={S.productPrice}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <Input
        aria-label={S.productUnit}
        placeholder={S.productUnit}
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
      />
      <Input
        aria-label={S.productDescription}
        placeholder={S.productDescription}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Button type="submit" disabled={isPending || name.trim() === "" || price.trim() === ""}>
        {submitLabel}
      </Button>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-5">
          {error}
        </p>
      )}
    </form>
  );
}
