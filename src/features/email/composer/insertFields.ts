// insertFields: resolves deal/person/org field values from the composer context.
// Returns an array of { label, value } pairs for the "Insert field" menu.
// Only includes fields that have a non-empty resolved value so the menu never
// shows blank entries. Inbox context has no deal data, so returns [].

// Named constants for each field label - no magic strings in call sites.
export const INSERT_FIELD_LABELS = {
  DEAL_TITLE: "Título do negócio",
  DEAL_VALUE: "Valor do negócio",
  FIRST_NAME: "Nome",
  LAST_NAME: "Sobrenome",
  CONTACT_EMAIL: "E-mail do contato",
  ORG_NAME: "Nome da organização",
} as const;

export interface InsertFieldEntry {
  label: string;
  value: string;
  // Entity the field belongs to, drives the Insert-field category tabs (PD parity).
  category?: "Pessoa" | "Negócio" | "Organização";
}

// Extended deal context that carries resolved person/org values for the insert menu.
// These come from data the deal page already has client-side; no extra fetch needed.
export type InsertFieldContext =
  | { kind: "inbox"; threadId?: string }
  | {
      kind: "deal";
      dealId: string;
      dealTitle?: string;
      dealValue?: string;
      personFirstName?: string;
      personLastName?: string;
      personEmail?: string;
      orgName?: string;
      // Remaining ComposerContext fields passed through transparently
      defaultTo?: string;
      personId?: string;
      orgId?: string;
    };

// Build the insert-field catalogue for the given context. Values are already
// resolved client-side from the deal workspace data; no server round-trip needed.
export function insertFields(context: InsertFieldContext): InsertFieldEntry[] {
  if (context.kind === "inbox") return [];

  const candidates: Array<[string, string | undefined, InsertFieldEntry["category"]]> = [
    [INSERT_FIELD_LABELS.DEAL_TITLE, context.dealTitle, "Negócio"],
    [INSERT_FIELD_LABELS.DEAL_VALUE, context.dealValue, "Negócio"],
    [INSERT_FIELD_LABELS.FIRST_NAME, context.personFirstName, "Pessoa"],
    [INSERT_FIELD_LABELS.LAST_NAME, context.personLastName, "Pessoa"],
    [INSERT_FIELD_LABELS.CONTACT_EMAIL, context.personEmail, "Pessoa"],
    [INSERT_FIELD_LABELS.ORG_NAME, context.orgName, "Organização"],
  ];

  return candidates
    .filter((entry): entry is [string, string, InsertFieldEntry["category"]] => {
      const value = entry[1];
      return value !== undefined && value.length > 0;
    })
    .map(([label, value, category]) => ({ label, value, category }));
}
