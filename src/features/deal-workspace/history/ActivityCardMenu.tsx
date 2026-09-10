"use client";
import { Ellipsis } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// "More actions" overflow for an activity card: Edit, the done/reopen toggle, and a
// confirmed Delete. Split out of ActivityCard so the card stays within the file budget.
export function ActivityCardMenu({
  done,
  busy,
  onEdit,
  onToggle,
  onDelete,
}: {
  done: boolean;
  busy: boolean;
  onEdit?: () => void;
  onToggle: () => void;
  onDelete: () => void;
}): React.ReactNode {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Mais ações"
        // Pseudo-element extends the 24px control to a ~40px hit target without changing layout.
        className="relative rounded p-1 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:bg-accent hover:text-foreground"
      >
        <Ellipsis aria-hidden="true" className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="Mais ações" className="min-w-40">
        {onEdit !== undefined && (
          <DropdownMenuItem onSelect={() => onEdit()}>Editar</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onToggle}>
          {done ? "Reabrir" : "Marcar como concluída"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => setConfirmingDelete(true)}
          className="text-destructive focus:text-destructive"
        >
          Excluir
        </DropdownMenuItem>
      </DropdownMenuContent>

      {/* Sibling of the menu content, not a child: the menu unmounts its items on select,
          which would take the dialog with it. */}
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Excluir atividade?"
        description="Essa ação não pode ser desfeita."
        confirmLabel="Excluir"
        destructive
        pending={busy}
        onConfirm={onDelete}
      />
    </DropdownMenu>
  );
}
