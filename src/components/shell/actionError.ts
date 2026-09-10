import { ERROR_IDS } from "@/constants/errorIds";

// Domain-neutral user-facing copy for a failed action (any feature: settings, leads, email,
// contacts) that would otherwise fail silently. Keyed by AppError id (src/constants/errorIds.ts);
// an unmapped id or a rejected promise with no id falls back to the generic entry. The
// deal-workspace has its own richer, deal-specific mapper (dealActionError.ts); this one is the
// app-wide default surfaced by ActionErrorProvider.
export interface ActionErrorContent {
  title: string;
  body: string;
}

const GENERIC: ActionErrorContent = {
  title: "Não foi possível concluir essa ação",
  body: "Algo deu errado e sua alteração não foi salva. Atualize a página e tente novamente.",
};

const CONTENT: Record<string, ActionErrorContent> = {
  [ERROR_IDS.PERM_DENIED]: {
    title: "Você não tem permissão",
    body: "Você não tem permissão para fazer essa alteração. Peça a um admin se achar que isso é um engano.",
  },
  [ERROR_IDS.AUTH_SESSION_DEAD]: {
    title: "Sua sessão expirou",
    body: "Faça login novamente para continuar.",
  },
  E_AUTH_CSRF: {
    title: "Sua sessão expirou",
    body: "Atualize a página e tente novamente.",
  },
  // Both convert outcomes are states the user can act on, so they never get the generic
  // "refresh and try again" copy: refreshing fixes neither.
  [ERROR_IDS.LEAD_CONVERT_NO_PIPELINE]: {
    title: "Nenhum funil para converter",
    body: "Crie um funil em Configurações e depois converta este lead novamente.",
  },
  [ERROR_IDS.LEAD_ALREADY_CONVERTED]: {
    title: "Este lead já foi convertido",
    body: "Ele já tem um negócio. Atualize a página para ver o estado atual.",
  },
  // The server rejected the filter's shape, so refreshing changes nothing: the user has to fix a
  // condition before the save can succeed.
  [ERROR_IDS.DEAL_FILTER_INVALID]: {
    title: "Uma dessas condições não é válida",
    body: "Verifique o valor de cada condição: um campo numérico precisa de um número, e um campo de data precisa de uma data.",
  },
};

export function actionErrorContent(errorId?: string): ActionErrorContent {
  if (errorId === undefined) return GENERIC;
  return CONTENT[errorId] ?? GENERIC;
}
