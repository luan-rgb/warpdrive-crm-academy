// Folder identity for the Sales Inbox rail. The active folder lives in the URL (?folder=),
// so this is the single parse/allow-list boundary (D3): unknown values fall back to inbox.
export const FOLDER_KEYS = ["inbox", "drafts", "outbox", "sent", "archive"] as const;

export type FolderKey = (typeof FOLDER_KEYS)[number];

export function parseFolder(raw: string | null | undefined): FolderKey {
  return FOLDER_KEYS.includes(raw as FolderKey) ? (raw as FolderKey) : "inbox";
}

export const FOLDER_LABELS: Record<FolderKey, string> = {
  inbox: "Caixa de entrada",
  drafts: "Rascunhos",
  outbox: "Caixa de saída",
  sent: "Enviados",
  archive: "Arquivados",
};
