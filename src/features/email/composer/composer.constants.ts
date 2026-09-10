// Named constants for the composer component tree. No magic strings in components.

// Client-side file size guard for AttachButton. Matches the server env default
// (MAX_FILE_BYTES = 26_214_400 = 25 MB). The server re-validates; this is a
// fast UX gate that avoids a round-trip for obviously oversized files.
export const ATTACH_MAX_FILE_BYTES = 26_214_400;

export const COMPOSER_STRINGS = {
  addAsActivityLabel: "Adicionar como atividade",
  addAsActivityTooltip: "A atividade será registrada neste negócio quando o e-mail for enviado",
  // Compose visibility (C1): "shared" reads as visible-to-everyone, "private" as private-to-you.
  // visibilityLabel is the shared/default wording; visibilityPickerLabel is the trigger aria-label.
  visibilityLabel: "Visível para todos",
  visibilityPrivateLabel: "Privado para você",
  visibilityPickerLabel: "Visibilidade do e-mail",
  defaultActivitySubject: "E-mail enviado",
  // System key for the email activity type (matches seed data in activityTypes.ts).
  emailActivityTypeKey: "email",
  // Inline validation shown when the Send-later time is not strictly in the future.
  scheduledPastMessage: "Escolha um horário no futuro",
  // Shown when the send never returned a Result. The deadline is on our view of the action, not
  // on Gmail, so the mail may well have gone out: this must not assert that the send failed.
  sendUnconfirmed:
    "Não foi possível confirmar o envio. Verifique a conversa antes de tentar novamente.",
  // Compose header controls (email-tab): Settings cog link + Close.
  headerSettingsLabel: "Configurações de e-mail",
  headerCloseLabel: "Fechar",
  // Toolbar signature picker.
  signaturePickerLabel: "Assinatura",
  signatureNoneLabel: "Nenhuma",
  signatureTitle: (name: string): string => `Assinatura: ${name}`,
} as const;
