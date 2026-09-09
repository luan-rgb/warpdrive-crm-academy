"use client";
import type React from "react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface BulkDeleteButtonProps {
  count: number;
  // Singular and plural forms of what is being deleted, e.g. "person" / "people".
  noun: string;
  nounPlural: string;
  onConfirm: () => void;
}

// The Delete control in a bulk-action bar. Deleting a page of records is not recoverable from the
// UI, so the count is restated in the dialog: the bar showing it is what the dialog covers.
export function BulkDeleteButton({
  count,
  noun,
  nounPlural,
  onConfirm,
}: BulkDeleteButtonProps): React.ReactNode {
  const [confirming, setConfirming] = useState(false);
  const unit = count === 1 ? noun : nounPlural;

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border px-3 py-1 text-sm transition-transform hover:bg-accent active:scale-[0.96]"
      >
        Excluir
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Excluir ${count} ${unit}?`}
        description={`Isso não pode ser desfeito, e remove os registros para todo o time.`}
        confirmLabel={`Excluir ${nounPlural}`}
        cancelLabel="Cancelar"
        destructive
        onConfirm={onConfirm}
      />
    </>
  );
}
