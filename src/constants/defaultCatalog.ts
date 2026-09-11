import type { LabelColor, LabelTarget } from "./labelColors";

// Single source of truth for the catalog a fresh install ships with: the default pipeline
// (name + stages) and the default label sets for every target. Both the first-run bootstrap
// (src/features/auth/seed.ts) and the demo catalog seed (scripts/seed-demo-catalog.ts) read
// from here so production defaults and demo data never drift apart.

export const DEFAULT_PIPELINE = {
  name: "Funil de vendas",
  stages: ["Qualificado", "Contato feito", "Demonstração agendada", "Negociação", "Fechamento"],
} as const;

// Stage insert rows for a new pipeline's default stages (order = index). Shared by the first-run
// bootstrap and the UI create path so a `stages` schema change updates both at once.
export function buildDefaultStageValues(
  pipelineId: string,
): { pipelineId: string; name: string; order: number }[] {
  return DEFAULT_PIPELINE.stages.map((name, order) => ({ pipelineId, name, order }));
}

// [name, color] tuples; array index is the persisted `order`. Colors are LabelColor members.
export const DEFAULT_LABELS: Record<LabelTarget, ReadonlyArray<readonly [string, LabelColor]>> = {
  person: [
    ["Defensor", "green"],
    ["Decisor", "purple"],
    ["Influenciador", "blue"],
    ["Bloqueador", "red"],
    ["Porteiro", "orange"],
  ],
  organization: [
    ["Enterprise", "purple"],
    ["Médio porte", "blue"],
    ["Pequena empresa", "teal"],
    ["Startup", "green"],
  ],
  deal: [
    ["Quente", "red"],
    ["Morno", "orange"],
    ["Frio", "blue"],
  ],
  lead: [
    ["Novo", "blue"],
    ["Em andamento", "orange"],
    ["Qualificado", "green"],
    ["Desqualificado", "gray"],
  ],
};
