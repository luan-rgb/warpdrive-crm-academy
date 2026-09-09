import type { ColumnDef } from "@/components/data-table/columnModel";

// The deals List-view column catalog. Title is pinned (row link). To match Pipedrive's default
// deals list (CV-4 / collection-views spec B4), Contact person, Next activity, and Expected close
// date are default-visible alongside Org/Value/Stage/Owner. Their data rides on the board card
// (personName / nextActivityAt / expectedCloseDate), so no extra query beyond one added SELECT.
export const DEAL_LIST_COLUMNS: readonly ColumnDef[] = [
  { key: "title", header: "Título", pinned: true, defaultVisible: true },
  { key: "org", header: "Organização", defaultVisible: true },
  { key: "value", header: "Valor", defaultVisible: true },
  { key: "stage", header: "Etapa", defaultVisible: true },
  { key: "owner", header: "Responsável", defaultVisible: true },
  { key: "person", header: "Pessoa de contato", defaultVisible: true },
  { key: "expectedCloseDate", header: "Data prevista de fechamento", defaultVisible: true },
  { key: "nextActivity", header: "Próxima atividade", defaultVisible: true },
] as const;

// Non-pinned deal-list column keys (everything the generic cell renderer handles; Title is rendered
// specially by DealList because it carries the inline-edit affordance).
export type DealListColumnKey =
  | "org"
  | "value"
  | "stage"
  | "owner"
  | "person"
  | "expectedCloseDate"
  | "nextActivity";
