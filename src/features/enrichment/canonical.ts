// The one vocabulary every enrichment provider normalises into. Admins map a canonical key to a
// target field ONCE, not once per provider, which is what keeps the mapping UI a single list
// instead of three; which provider supplied a value is carried on the run, not on the mapping.

export type EnrichEntity = "person" | "organization";
export type CanonicalValueType = "string" | "number";

export interface CanonicalField {
  key: string;
  entity: EnrichEntity;
  label: string;
  valueType: CanonicalValueType;
}

const P = (
  key: string,
  label: string,
  valueType: CanonicalValueType = "string",
): CanonicalField => ({
  key: `person.${key}`,
  entity: "person",
  label,
  valueType,
});

const O = (
  key: string,
  label: string,
  valueType: CanonicalValueType = "string",
): CanonicalField => ({
  key: `org.${key}`,
  entity: "organization",
  label,
  valueType,
});

export const CANONICAL_FIELDS: readonly CanonicalField[] = [
  P("firstName", "Primeiro nome"),
  P("lastName", "Sobrenome"),
  P("fullName", "Nome completo"),
  P("email", "Email"),
  P("title", "Cargo"),
  P("seniority", "Senioridade"),
  P("department", "Departamento"),
  P("linkedinUrl", "URL do LinkedIn"),
  P("twitterHandle", "Perfil do X / Twitter"),
  P("githubUrl", "URL do GitHub"),
  P("photoUrl", "URL da foto"),
  P("city", "Cidade"),
  P("state", "Estado / região"),
  P("country", "País"),
  P("companyName", "Nome da empresa"),
  P("companyDomain", "Domínio da empresa"),
  O("name", "Nome"),
  O("domain", "Site / domínio"),
  O("website", "URL do site"),
  O("industry", "Setor"),
  O("employeeCount", "Número de funcionários", "number"),
  O("annualRevenue", "Faturamento anual", "number"),
  O("linkedinUrl", "URL do LinkedIn"),
  O("twitterHandle", "Perfil do X / Twitter"),
  O("description", "Descrição"),
  O("foundedYear", "Ano de fundação", "number"),
  O("street", "Endereço: rua"),
  O("city", "Endereço: cidade"),
  O("state", "Endereço: estado / região"),
  O("postalCode", "Endereço: código postal"),
  O("country", "Endereço: país"),
] as const;

const BY_KEY = new Map(CANONICAL_FIELDS.map((f) => [f.key, f]));

export function isCanonicalKey(key: string): boolean {
  return BY_KEY.has(key);
}

export function canonicalField(key: string): CanonicalField | undefined {
  return BY_KEY.get(key);
}

export function canonicalKeysFor(entity: EnrichEntity): string[] {
  return CANONICAL_FIELDS.filter((f) => f.entity === entity).map((f) => f.key);
}

export function valueTypeOf(key: string): CanonicalValueType | undefined {
  return BY_KEY.get(key)?.valueType;
}

// Seeded on first visit to the settings page. Built-ins only: they exist on every install, whereas
// a custom field has to be created before it can be a target. Address leaves reuse the names the
// import mapper already uses (ENTITY_FIELDS.organization), so there is only ever one address shape.
export const DEFAULT_BUILTIN_MAPPINGS: Readonly<Record<string, string>> = {
  "org.domain": "domain",
  "org.industry": "industry",
  "org.employeeCount": "employeeCount",
  "org.annualRevenue": "annualRevenue",
  "org.linkedinUrl": "linkedinUrl",
  "org.street": "address.street",
  "org.city": "address.city",
  "org.state": "address.region",
  "org.postalCode": "address.postal",
  "org.country": "address.country",
  "person.email": "emails",
  "person.companyName": "org",
  "person.firstName": "firstName",
  "person.lastName": "lastName",
};
