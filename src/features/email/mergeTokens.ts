// Merge-token catalog for the template authoring UI. A template stores literal {{token}}
// placeholders that the send path resolves per-recipient via mergeContext.ts + applyMergeFields.
// This list MUST stay in sync with the put(ctx, ...) calls in mergeContext.ts: the UI may only
// offer a token the send-time context can actually produce (guarded by mergeTokens.test.ts).
export interface MergeTokenField {
  label: string;
  token: string;
}

export const MERGE_TOKEN_FIELDS: readonly MergeTokenField[] = [
  { label: "Nome", token: "person.first_name" },
  { label: "Sobrenome", token: "person.last_name" },
  { label: "Nome completo", token: "person.name" },
  { label: "E-mail do contato", token: "person.email" },
  { label: "Título do negócio", token: "deal.title" },
  { label: "Valor do negócio", token: "deal.value" },
  { label: "Nome da organização", token: "org.name" },
];

// Wrap a token as the {{token}} placeholder inserted into template text.
export function mergeTokenPlaceholder(token: string): string {
  return `{{${token}}}`;
}
