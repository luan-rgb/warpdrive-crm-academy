import type { CustomFieldTarget } from "./customFieldTypes";

// The standard (built-in) fields each entity ships with, shown in Settings > Data fields alongside
// custom fields. Built-in fields are NOT rows in custom_field_defs; this catalog is their source of
// truth. `key` matches the import field name (src/features/import/importFields.ts) where an import
// field exists, so ONE key gates every consumer (settings, import picker, forms, detail views).
// UI-only fields (owner, label, related org/person) have no import field; that is fine, they simply
// never match an import option. `locked` fields are the identity / find-or-create key and cannot be
// hidden.
export interface BuiltinField {
  key: string;
  label: string;
  locked: boolean;
}

const L = (key: string, label: string): BuiltinField => ({ key, label, locked: true });
const F = (key: string, label: string): BuiltinField => ({ key, label, locked: false });

export const BUILTIN_FIELDS: Record<CustomFieldTarget, readonly BuiltinField[]> = {
  organization: [
    L("name", "Nome"),
    F("domain", "Site / domínio"),
    F("industry", "Setor"),
    F("employeeCount", "Número de funcionários"),
    F("annualRevenue", "Faturamento anual"),
    F("linkedinUrl", "URL do LinkedIn"),
    F("address", "Endereço"),
    F("owner", "Dono"),
    F("label", "Etiqueta"),
  ],
  person: [
    L("name", "Nome"),
    F("firstName", "Primeiro nome"),
    F("lastName", "Sobrenome"),
    F("emails", "Email"),
    F("phones", "Telefone"),
    F("org", "Organização"),
    F("owner", "Dono"),
    F("label", "Etiqueta"),
  ],
  deal: [
    L("title", "Título"),
    F("value", "Valor"),
    F("expectedCloseDate", "Data prevista de fechamento"),
    F("pipeline", "Pipeline"),
    F("stage", "Etapa"),
    F("org", "Organização"),
    F("person", "Pessoa"),
    F("owner", "Dono"),
    F("label", "Etiqueta"),
  ],
  activity: [
    L("subject", "Assunto"),
    F("typeKey", "Tipo"),
    F("dueAt", "Data de vencimento"),
    F("durationMinutes", "Duração"),
  ],
};

function fieldFor(entity: CustomFieldTarget, key: string): BuiltinField | undefined {
  return BUILTIN_FIELDS[entity].find((f) => f.key === key);
}

export function isBuiltinFieldKey(entity: CustomFieldTarget, key: string): boolean {
  return fieldFor(entity, key) !== undefined;
}

export function isBuiltinLocked(entity: CustomFieldTarget, key: string): boolean {
  return fieldFor(entity, key)?.locked === true;
}

// Is a given import field (by its import field name) hidden? True when its key is hidden directly,
// or when it is an address leaf and "address" is hidden (import splits the one "address" built-in
// into dotted leaves). Entity-agnostic: only organization has address.* import leaves, so the
// address-root check is unambiguous across entities. UI gating uses plain `hidden.has(key)`.
export function isImportFieldHidden(importFieldKey: string, hidden: ReadonlySet<string>): boolean {
  if (hidden.has(importFieldKey)) return true;
  if (importFieldKey.startsWith("address.") && hidden.has("address")) return true;
  return false;
}
