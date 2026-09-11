// The fields the import mapping step can target, keyed by the ENTITY that owns them rather than
// by the import's target. A CSV row routinely describes more than one record (a BD shortlist row
// is a lead AND its organization), and Pipedrive's picker is entity-tabbed for exactly that
// reason. mapRow groups the mapped cells back out by entity; commit writes each group through its
// own authority. Custom fields come from listDefs at render time.
import type { ImportTarget } from "./wizardState";

// Upper bound for a client-parsed CSV (25 MB, matching the attachment cap). The browser
// reads the whole file into memory and tokenizes it char by char, so an unbounded file
// (a 500 MB mis-selection) would freeze the tab; the upload step rejects anything larger.
export const MAX_IMPORT_CSV_BYTES = 26_214_400;

// "note" is not an import target; it is an extra record a row can produce alongside its primary.
export type MappableEntity = ImportTarget | "note";

export interface StandardImportField {
  field: string;
  label: string;
  required: boolean;
  // Other fields of the same entity that stand in for this one. Person > Name is required, but a
  // contact export routinely splits it, so mapping either part satisfies it and mapRow joins them.
  satisfiedBy?: readonly string[];
}

// The person columns whose values a display name can be built from, in the order they are joined.
export const PERSON_NAME_PARTS = ["firstName", "lastName"] as const;

// Nested-object leaves are offered as dotted paths ("address.city"). orgCreateInput.address is a
// structured object that would reject a raw CSV cell, so mapRow reassembles the leaves instead of
// exposing a bare "address" field.
export const ADDRESS_PREFIX = "address.";

export const ENTITY_FIELDS: Record<MappableEntity, readonly StandardImportField[]> = {
  person: [
    { field: "name", label: "Nome", required: true, satisfiedBy: PERSON_NAME_PARTS },
    { field: "firstName", label: "Primeiro nome", required: false },
    { field: "lastName", label: "Sobrenome", required: false },
    { field: "emails", label: "Email", required: false },
    { field: "phones", label: "Telefone", required: false },
  ],
  organization: [
    { field: "name", label: "Nome", required: true },
    { field: "domain", label: "Site / domínio", required: false },
    { field: "industry", label: "Setor", required: false },
    { field: "employeeCount", label: "Número de funcionários", required: false },
    { field: "annualRevenue", label: "Faturamento anual", required: false },
    { field: "linkedinUrl", label: "URL do LinkedIn", required: false },
    { field: "address.street", label: "Endereço: rua", required: false },
    { field: "address.city", label: "Endereço: cidade", required: false },
    { field: "address.region", label: "Endereço: estado / região", required: false },
    { field: "address.postal", label: "Endereço: código postal", required: false },
    { field: "address.country", label: "Endereço: país", required: false },
  ],
  deal: [
    { field: "title", label: "Título", required: true },
    { field: "value", label: "Valor", required: false },
    { field: "expectedCloseDate", label: "Data prevista de fechamento", required: false },
    { field: "pipeline", label: "Pipeline", required: false },
    { field: "stage", label: "Etapa", required: false },
  ],
  lead: [
    { field: "title", label: "Título", required: true },
    { field: "value", label: "Valor", required: false },
    { field: "expectedCloseDate", label: "Data prevista de fechamento", required: false },
    { field: "sourceChannel", label: "Canal de origem", required: false },
    { field: "sourceChannelId", label: "ID do canal de origem", required: false },
  ],
  activity: [
    { field: "subject", label: "Assunto", required: true },
    { field: "typeKey", label: "Tipo", required: false },
    { field: "dueAt", label: "Data de vencimento", required: false },
    { field: "durationMinutes", label: "Duração (minutos)", required: false },
  ],
  note: [{ field: "body", label: "Nota", required: false }],
};

export const ENTITY_LABELS: Record<MappableEntity, string> = {
  person: "Pessoa",
  organization: "Organização",
  deal: "Negócio",
  lead: "Lead",
  activity: "Atividade",
  note: "Nota",
};

// A picker label that carries its destination record: "Organization[Name]", "Person[Name]". The
// group heading above an open menu says which entity a field belongs to, but a COLLAPSED picker
// shows the label alone, and a person import can map one column to Person > Name and another to
// Organization > Name. Unqualified, both read "Name": one string for two different writes. The
// note entity's only field is already called "Note", so qualifying it would stutter.
export function qualifiedFieldLabel(entity: MappableEntity, fieldLabel: string): string {
  const entityLabel = ENTITY_LABELS[entity];
  if (fieldLabel === entityLabel) return entityLabel;
  return `${entityLabel}[${fieldLabel}]`;
}

// The entity a target's row primarily creates. Targets and entities share names, but the
// distinction matters: "note" is an entity that is never a target.
export function primaryEntityOf(target: ImportTarget): MappableEntity {
  return target;
}

// Which entities each target's row may write, primary first. A deal row can name its organization
// and its contact person.
//
// Activity has no note group: notes attach only to deal/person/organization/lead (ENTITY_TYPES),
// so offering "Note" on an activity import would produce a mapping that fails at commit.
export const TARGET_ENTITY_GROUPS: Record<ImportTarget, readonly MappableEntity[]> = {
  person: ["person", "organization", "note"],
  organization: ["organization", "note"],
  deal: ["deal", "organization", "person", "note"],
  lead: ["lead", "organization", "note"],
  activity: ["activity"],
};

// The primary entity's fields. Mapping-completeness and the per-target row schemas read this, so
// the required-field list has exactly one source of truth.
export const STANDARD_IMPORT_FIELDS: Record<ImportTarget, readonly StandardImportField[]> = {
  person: ENTITY_FIELDS.person,
  organization: ENTITY_FIELDS.organization,
  deal: ENTITY_FIELDS.deal,
  lead: ENTITY_FIELDS.lead,
  activity: ENTITY_FIELDS.activity,
};
