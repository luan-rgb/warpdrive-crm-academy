// Copy for the board's applied-filter chips and its three empty states. The board owns its wording
// here rather than in the shared STRINGS module, matching bulkMoveCopy.

// A filter that excluded every card is a different sentence from a pipeline with nothing in it:
// one is hiding deals and can be undone, the other is waiting for a first deal.
export const BOARD_EMPTY_FILTERED_TITLE = "Nenhum negócio corresponde a esses filtros";
export const BOARD_EMPTY_FILTERED_BODY =
  "O quadro está mostrando um subconjunto. Limpe os filtros para ver o pipeline inteiro novamente.";
export const BOARD_CLEAR_FILTERS = "Limpar filtros";

// Filters are applied and the server returned nothing, which looks identical whether the filters
// excluded everything or the pipeline is empty. Neither is asserted, and both exits are offered.
export const BOARD_EMPTY_UNSURE_TITLE = "Nada para mostrar aqui";
export const BOARD_EMPTY_UNSURE_BODY =
  "Este pipeline tem filtros aplicados. Limpe-os para ver tudo nele, ou adicione um negócio.";

export const BOARD_EMPTY_TITLE = "Ainda não há negócios neste pipeline";
export const BOARD_EMPTY_BODY =
  "Um negócio é uma oportunidade: um valor, uma etapa e um responsável. Adicione o primeiro e ele aparece numa coluna de etapa abaixo.";

export const BOARD_CHIPS_LABEL = "Filtros aplicados";
export const BOARD_CLEAR_ALL = "Limpar tudo";

export function ownerChipLabel(name: string): string {
  return `Responsável: ${name}`;
}

export function savedFilterChipLabel(name: string): string {
  return `Filtro: ${name}`;
}

export function conditionChipLabel(count: number): string {
  return `${count} ${count === 1 ? "condição" : "condições"}`;
}
