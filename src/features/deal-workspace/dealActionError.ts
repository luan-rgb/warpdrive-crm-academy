import { ERROR_IDS } from "@/constants/errorIds";

// User-facing copy for a failed deal action (stage change, label edit, inline field save) that
// would otherwise be swallowed silently. Keyed by AppError id (src/constants/errorIds.ts); an
// unlisted id or a rejected promise with no id falls back to the generic entry. Mirrors the
// inline saveError map but returns a title+body pair for a modal instead of one inline line.
export interface DealActionErrorContent {
  title: string;
  body: string;
}

const GENERIC: DealActionErrorContent = {
  title: "Não foi possível salvar sua alteração",
  body: "Algo deu errado. Atualize a página e tente novamente.",
};

const CONTENT: Record<string, DealActionErrorContent> = {
  [ERROR_IDS.PERM_DENIED]: {
    title: "Você não tem permissão",
    body: "Somente o dono do negócio (ou um admin) pode fazer essa alteração. Peça ao dono para atualizar ou transferir o negócio.",
  },
  [ERROR_IDS.NOTE_NOT_AUTHOR]: {
    title: "Você não tem permissão",
    body: "Somente quem escreveu a nota (ou um admin) pode editá-la ou excluí-la.",
  },
  [ERROR_IDS.DEAL_PRECONDITION]: {
    title: "Este negócio mudou em outro lugar",
    body: "Este negócio mudou enquanto você editava. Recarregamos os dados, tente sua alteração novamente.",
  },
  [ERROR_IDS.DEAL_NOT_FOUND]: {
    title: "Negócio indisponível",
    body: "Este negócio não está mais disponível para você. Ele pode ter sido excluído ou sua visibilidade alterada.",
  },
  [ERROR_IDS.AUTH_SESSION_DEAD]: {
    title: "Sua sessão expirou",
    body: "Faça login novamente para continuar.",
  },
  E_AUTH_CSRF: {
    title: "Sua sessão expirou",
    body: "Atualize a página e tente novamente.",
  },
};

export function dealActionErrorContent(errorId?: string): DealActionErrorContent {
  if (errorId === undefined) return GENERIC;
  return CONTENT[errorId] ?? GENERIC;
}
