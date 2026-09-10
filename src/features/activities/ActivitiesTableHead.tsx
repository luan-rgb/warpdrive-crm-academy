"use client";
import type React from "react";
import type { ColumnSort } from "@/components/data-table/useColumnSort";
import { Checkbox } from "@/components/ui/Checkbox";
import { ActivitySortableTh } from "./ActivitySortableHeader";
import type { ActivitySortField } from "./schemas";

interface ActivitiesTableHeadProps {
  effective: ColumnSort<ActivitySortField>;
  onSort: (field: ActivitySortField) => void;
  allSelected: boolean;
  onToggleAll: () => void;
}

// The Activities table's <thead>, extracted from ActivitiesTable to keep it under the
// project's file-size budget. Column order and labels are Pipedrive parity (Task 8's
// Duration/Assignee columns, Task 9's sortable Duration).
export function ActivitiesTableHead({
  effective,
  onSort,
  allSelected,
  onToggleAll,
}: ActivitiesTableHeadProps): React.ReactNode {
  return (
    <thead className="sticky top-0 bg-muted/60 text-left text-xs uppercase text-muted-foreground">
      <tr>
        <th className="w-8 px-3 py-2">
          <Checkbox
            label="Selecionar todas as atividades"
            checked={allSelected}
            onCheckedChange={onToggleAll}
          />
        </th>
        <th className="px-3 py-2 font-semibold">Concluída</th>
        <ActivitySortableTh field="subject" label="Assunto" sort={effective} onSort={onSort} />
        <th className="px-3 py-2 font-semibold">Negócio</th>
        <ActivitySortableTh
          field="priority"
          label="Prioridade"
          sort={effective}
          onSort={onSort}
        />
        <th className="px-3 py-2 font-semibold">Contato</th>
        <th className="px-3 py-2 font-semibold">Email</th>
        <th className="px-3 py-2 font-semibold">Telefone</th>
        <th className="px-3 py-2 font-semibold">Organização</th>
        <ActivitySortableTh
          field="dueAtIso"
          label="Vencimento"
          sort={effective}
          onSort={onSort}
        />
        <ActivitySortableTh
          field="duration"
          label="Duração"
          sort={effective}
          onSort={onSort}
        />
        <th className="px-3 py-2 font-semibold">Responsável</th>
      </tr>
    </thead>
  );
}
