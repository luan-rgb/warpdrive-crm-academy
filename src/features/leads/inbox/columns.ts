import type { LeadSortField } from "../schemas";

// Ordered column descriptors for the Leads Inbox table. Title is pinned (always visible, cannot be
// hidden and anchors the row link). `sortField` maps a column to the server ORDER BY field; null
// means the column is not sortable. `defaultVisible` seeds useLeadColumns before user prefs load.
export interface LeadColumn {
  key: string;
  header: string;
  sortField: LeadSortField | null;
  pinned: boolean;
  defaultVisible: boolean;
}

export const LEAD_COLUMNS: readonly LeadColumn[] = [
  { key: "title", header: "Título", sortField: "title", pinned: true, defaultVisible: true },
  {
    key: "nextActivity",
    header: "Próxima atividade",
    sortField: "nextActivityAt",
    pinned: false,
    defaultVisible: true,
  },
  { key: "labels", header: "Etiquetas", sortField: "label", pinned: false, defaultVisible: true },
  {
    key: "sourceOrigin",
    header: "Origem",
    sortField: "sourceOrigin",
    pinned: false,
    defaultVisible: true,
  },
  { key: "value", header: "Valor", sortField: "value", pinned: false, defaultVisible: false },
  {
    key: "createdAt",
    header: "Lead criado",
    sortField: "createdAt",
    pinned: false,
    defaultVisible: true,
  },
  {
    key: "owner",
    header: "Responsável",
    sortField: "ownerName",
    pinned: false,
    defaultVisible: true,
  },
] as const;

export const LEAD_COLUMN_KEYS = LEAD_COLUMNS.map((c) => c.key);

// The keys visible by default (feeds the initial visible-set before persisted prefs hydrate).
export const DEFAULT_VISIBLE_COLUMN_KEYS = LEAD_COLUMNS.filter((c) => c.defaultVisible).map(
  (c) => c.key,
);
