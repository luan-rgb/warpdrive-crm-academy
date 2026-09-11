// notifyStrings.ts: human-readable change summaries used in notification payloads.
// Named constants prevent magic strings from scattering across action files.
export const NOTIFY_STRINGS = {
  dealUpdated: "Os detalhes do negócio foram atualizados",
  dealMoved: "Negócio movido para uma nova etapa",
} as const;
