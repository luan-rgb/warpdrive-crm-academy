"use client";
import { Trash2 } from "lucide-react";
import type React from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

// A saved filter or view the user has asked to delete, held until they confirm.
export interface PendingFilterDelete {
  id: string;
  name: string;
  isShared: boolean;
}

// The row's delete trigger. A sibling menu item (not a button nested in the row) so it keeps its
// place in the arrow-key order and does not pick the filter, and preventDefault keeps the menu
// mounted so the confirmation it raises is not torn down with it.
export function DeleteSavedFilterItem({
  target,
  onRequest,
}: {
  target: PendingFilterDelete;
  onRequest: (target: PendingFilterDelete) => void;
}): React.ReactNode {
  return (
    <DropdownMenuItem
      aria-label={`Excluir ${target.name}`}
      onSelect={(e) => {
        e.preventDefault();
        onRequest(target);
      }}
      className="shrink-0 px-1.5 text-muted-foreground focus:text-destructive"
    >
      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
    </DropdownMenuItem>
  );
}

// One confirmation for both saved-filter menus, so the board and the record lists word it alike.
export function DeleteSavedFilterConfirm({
  pending,
  noun,
  onOpenChange,
  onConfirm,
}: {
  pending: PendingFilterDelete | null;
  // What this menu calls a row: "filter" on the board, "view" on the People/Orgs/Leads lists.
  noun: "filter" | "view";
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => void;
}): React.ReactNode {
  if (pending === null) return null;
  const nounLabel = noun === "filter" ? "filtro" : "visualização";
  // A shared row is deleted outright, so it goes for everyone who could see it.
  const scope = pending.isShared ? ", para todos com quem foi compartilhado" : "";
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={`Excluir ${nounLabel}?`}
      description={`"${pending.name}" será excluído${scope}. Essa ação não pode ser desfeita.`}
      confirmLabel="Excluir"
      destructive
      onConfirm={() => onConfirm(pending.id)}
    />
  );
}
