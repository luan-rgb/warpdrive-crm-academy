"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import type { Product } from "@/db/schema/products";
import { createProductAction, updateProductAction } from "@/features/products/actions";
import { readCsrfToken } from "@/utils/csrfCookie";
import { type ProductDraft, ProductForm } from "./ProductForm";
import { ProductsTable } from "./ProductsTable";

const S = SETTINGS_STRINGS;

export function ProductsClient({ products }: { products: Product[] }): React.ReactElement {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [editing, setEditing] = useState<Product | null>(null);

  async function create(draft: ProductDraft) {
    const r = await createProductAction(draft, readCsrfToken());
    return { ok: r.ok, errorId: r.ok ? undefined : r.error.id };
  }

  async function update(id: string, draft: ProductDraft) {
    const r = await updateProductAction({ id, ...draft }, readCsrfToken());
    return { ok: r.ok, errorId: r.ok ? undefined : r.error.id };
  }

  return (
    <>
      <ProductForm submitLabel={S.productCreate} onSubmit={create} onDone={refresh} />
      <div className="mt-6">
        <ProductsTable products={products} onChanged={refresh} onEdit={setEditing} />
      </div>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{S.productEdit}</DialogTitle>
          </DialogHeader>
          {editing !== null && (
            <ProductForm
              initial={editing}
              submitLabel={S.productSave}
              onSubmit={(draft) => update(editing.id, draft)}
              onDone={() => {
                setEditing(null);
                refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
