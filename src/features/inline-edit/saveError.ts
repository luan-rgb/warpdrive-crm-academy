import { SAVE_ERROR_MESSAGE } from "./constants";

// Maps the AppError id from a failed inline save to clear, user-facing copy so a denied or expired
// action reads as what it is, not a bare "Couldn't save". Ids come from src/constants/errorIds.ts;
// anything not listed (or a rejected promise with no id) falls back to the generic message.
const MESSAGES: Record<string, string> = {
  E_PERM_001: "Você não tem permissão para editar isto.", // contact.edit / action denied
  E_CONTACT_001: "Este registro não está mais disponível.", // not found or no longer visible
  E_CONTACT_008: "Esse valor não é válido.", // input failed validation
  E_AUTH_003: "Sua sessão expirou. Faça login novamente.",
  E_AUTH_CSRF: "Sua sessão expirou. Atualize a página e tente novamente.",
};

export function saveErrorMessage(errorId?: string): string {
  if (errorId === undefined) return SAVE_ERROR_MESSAGE;
  return MESSAGES[errorId] ?? SAVE_ERROR_MESSAGE;
}
