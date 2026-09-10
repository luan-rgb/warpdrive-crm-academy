"use client";
import type React from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { mergeLabelOptions } from "@/features/labels/mergeLabelOptions";
import { trpc } from "@/lib/trpc-client";
import type { LeadNextActivityBucket } from "../schemas";
import { POP_ITEM, PopMenu } from "./PopMenu";

// Owner filtering is always server-side: the menu lists real users from identity.assignableUsers
// (ungated) and drives filters.ownerIds by id. No client-name fallback: every user, manager or not,
// filters against the full server-side owner set.
export interface OwnerFilter {
  users: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

const NEXT_ACTIVITY_OPTIONS: { key: LeadNextActivityBucket; label: string }[] = [
  { key: "overdue", label: "Atrasada" },
  { key: "today", label: "Hoje" },
  { key: "week", label: "Esta semana" },
  { key: "none", label: "Sem atividade" },
];

const TRIGGER =
  "flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-sm hover:bg-accent";

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function OwnerMenu({ owner }: { owner: OwnerFilter }): React.ReactNode {
  const label =
    owner.selected.length === 0
      ? "Todos"
      : `${owner.selected.length} ${owner.selected.length === 1 ? "responsável" : "responsáveis"}`;
  return (
    <PopMenu
      triggerLabel="Filtro de responsável"
      triggerClassName={TRIGGER}
      trigger={<span>{label}</span>}
    >
      {() => (
        <div className="max-h-64 overflow-auto">
          <button type="button" className={POP_ITEM} onClick={() => owner.onChange([])}>
            Todos
          </button>
          {owner.users.map((u) => (
            <div key={u.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
              <Checkbox
                label={u.name}
                checked={owner.selected.includes(u.id)}
                onCheckedChange={() => owner.onChange(toggle(owner.selected, u.id))}
              />
              <span>{u.name}</span>
            </div>
          ))}
        </div>
      )}
    </PopMenu>
  );
}

export interface LeadFiltersProps {
  labelKeys: string[];
  onLabelKeys: (keys: string[]) => void;
  nextActivity: LeadNextActivityBucket | null;
  onNextActivity: (b: LeadNextActivityBucket | null) => void;
  owner: OwnerFilter;
}

export function LeadFilters({
  labelKeys,
  onLabelKeys,
  nextActivity,
  onNextActivity,
  owner,
}: LeadFiltersProps): React.ReactNode {
  const catalogNames = (trpc.labels.listByTarget.useQuery({ target: "lead" }).data ?? []).map(
    (l) => l.name,
  );
  // Union in what leads actually carry. The catalog is the control point for applying a label, but
  // a name written straight to the database is still rendered on the row, and a filter that omits
  // a label the user can see on screen reads as broken. Catalog order first, then the strays.
  const appliedNames = trpc.labels.appliedNames.useQuery({ target: "lead" }).data ?? [];
  const allLabels = mergeLabelOptions(catalogNames, appliedNames);
  const labelText = labelKeys.length === 0 ? "Todas as etiquetas" : `${labelKeys.length} etiquetas`;
  const naText =
    nextActivity === null
      ? "Próxima atividade"
      : (NEXT_ACTIVITY_OPTIONS.find((o) => o.key === nextActivity)?.label ?? "Próxima atividade");

  return (
    <>
      <PopMenu
        triggerLabel="Filtro de etiqueta"
        triggerClassName={TRIGGER}
        trigger={<span>{labelText}</span>}
      >
        {() => (
          <div>
            <button type="button" className={POP_ITEM} onClick={() => onLabelKeys([])}>
              Todas as etiquetas
            </button>
            {allLabels.map((name) => (
              <div
                key={name}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent"
              >
                <Checkbox
                  label={name}
                  checked={labelKeys.includes(name)}
                  onCheckedChange={() => onLabelKeys(toggle(labelKeys, name))}
                />
                <span>{name}</span>
              </div>
            ))}
          </div>
        )}
      </PopMenu>

      <PopMenu
        triggerLabel="Filtro de próxima atividade"
        triggerClassName={TRIGGER}
        trigger={<span>{naText}</span>}
      >
        {(close) => (
          <div>
            <button
              type="button"
              className={POP_ITEM}
              onClick={() => {
                onNextActivity(null);
                close();
              }}
            >
              Qualquer período
            </button>
            {NEXT_ACTIVITY_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                className={POP_ITEM}
                onClick={() => {
                  onNextActivity(o.key);
                  close();
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </PopMenu>

      <OwnerMenu owner={owner} />
    </>
  );
}
