import { assertNever } from "@/types/result";

// What Save does for the filter the dialog was opened on. updateSavedFilter is owner-scoped in SQL,
// so a shared filter owned by someone else can only be forked, never updated in place.
export type FilterSaveMode = "create" | "update" | "fork";

export function filterSaveMode(savedFilter?: { isOwn: boolean }): FilterSaveMode {
  if (savedFilter === undefined) return "create";
  return savedFilter.isOwn ? "update" : "fork";
}

export interface FilterSaveCopy {
  title: string;
  saveLabel: string;
  // Only the fork needs explaining: the user opened a filter to edit and gets a copy instead.
  note: string | null;
}

export function filterSaveCopy(mode: FilterSaveMode): FilterSaveCopy {
  switch (mode) {
    case "create":
      return { title: "Criar novo filtro", saveLabel: "Salvar", note: null };
    case "update":
      return { title: "Editar filtro", saveLabel: "Salvar alterações", note: null };
    case "fork":
      return {
        title: "Salvar como novo filtro",
        saveLabel: "Salvar como novo",
        note: "Você não é dono deste filtro, então suas alterações são salvas como um novo.",
      };
    default:
      return assertNever(mode);
  }
}
