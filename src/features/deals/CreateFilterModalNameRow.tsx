"use client";
import type React from "react";
import { useId } from "react";
import { Checkbox } from "@/components/ui/Checkbox";

interface CreateFilterModalNameRowProps {
  name: string;
  onNameChange: (name: string) => void;
  isShared: boolean;
  onSharedChange: (isShared: boolean) => void;
}

// Name field + shared toggle, the row under the conditions in the filter dialog.
export function CreateFilterModalNameRow({
  name,
  onNameChange,
  isShared,
  onSharedChange,
}: CreateFilterModalNameRowProps): React.ReactNode {
  const nameId = useId();
  return (
    <div className="grid grid-cols-2 gap-4 pt-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium" id={nameId}>
          Nome do filtro
        </span>
        <input
          aria-labelledby={nameId}
          aria-label="Nome do filtro"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Nomeado a partir das suas condições"
          className="w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
        />
      </label>
      <div className="flex items-center gap-2 self-end pb-1.5 text-sm">
        <Checkbox label="Compartilhado" checked={isShared} onCheckedChange={onSharedChange} />
        <span>Compartilhado com todos</span>
      </div>
    </div>
  );
}
