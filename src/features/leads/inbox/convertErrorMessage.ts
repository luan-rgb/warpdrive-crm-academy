import { ERROR_IDS } from "@/constants/errorIds";

// Map convert AppError ids to user-facing copy. The stale-CAS conflict is surfaced by leadConvert as
// LEAD_NOT_FOUND ("Lead changed before convert"), so it reads as a refresh prompt, not a hard error.
const MESSAGES: Record<string, string> = {
  [ERROR_IDS.PERM_DENIED]: "Você não tem permissão para criar negócios.",
  [ERROR_IDS.LEAD_ALREADY_CONVERTED]: "Este lead já foi convertido.",
  [ERROR_IDS.LEAD_NOT_FOUND]: "Este lead mudou desde que foi carregado. Atualizando.",
  [ERROR_IDS.LEAD_CONVERT_NO_PIPELINE]: "Nenhum funil de destino está configurado para conversão.",
};

export function convertErrorMessage(id: string): string {
  return MESSAGES[id] ?? "Não foi possível converter este lead.";
}
