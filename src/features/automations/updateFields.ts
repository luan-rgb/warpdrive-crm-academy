// Deal fields the update_field action may set, with a label for the wizard and the parser that
// turns the stored string into the column value (null = reject). Shared by the save-time schema
// and the runner so both agree on exactly what is allowed.
export const AUTOMATION_UPDATE_FIELDS = {
  title: { label: "Título", parse: (v: string) => (v.trim() === "" ? null : v.trim()) },
  value: {
    label: "Valor",
    parse: (v: string) => {
      const n = Number(v.replace(",", "."));
      return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
    },
  },
  stageId: { label: "Etapa", parse: (v: string) => (v === "" ? null : v) },
  ownerId: { label: "Responsável", parse: (v: string) => (v === "" ? null : v) },
  expectedCloseDate: {
    label: "Data prevista de fechamento",
    parse: (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null),
  },
} as const;

export type AutomationUpdateField = keyof typeof AUTOMATION_UPDATE_FIELDS;

export function isAutomationUpdateField(key: unknown): key is AutomationUpdateField {
  return typeof key === "string" && key in AUTOMATION_UPDATE_FIELDS;
}
