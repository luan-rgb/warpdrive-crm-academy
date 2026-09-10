import type { ComboboxOption } from "@/components/ui/Combobox";
import type { SelectOption } from "@/components/ui/Select";

// Shared option sets for the activities owner + status filters, used by both the list toolbar
// (ActivitiesFilters) and the calendar toolbar (CalendarFilterBar) so the two stay in sync.
export const ALL_OWNERS_OPTION: ComboboxOption = { value: "", label: "Todos os donos" };

export const DONE_FILTER_OPTIONS: SelectOption[] = [
  { value: "open", label: "Em aberto" },
  { value: "done", label: "Concluídas" },
  { value: "all", label: "Todas" },
];
