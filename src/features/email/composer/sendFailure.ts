import { ERROR_IDS } from "@/constants/errorIds";
import { STRINGS } from "@/constants/strings";
import { COMPOSER_STRINGS } from "./composer.constants";

const MESSAGES: Record<string, string> = {
  [ERROR_IDS.UI_STALE_BUILD]:
    "O Warpdrive foi atualizado enquanto esta página estava aberta. Atualize a página e envie novamente.",
  [ERROR_IDS.UI_ACTION_UNCONFIRMED]: COMPOSER_STRINGS.sendUnconfirmed,
  [ERROR_IDS.PERM_DENIED]:
    "Sua sessão não é mais válida. Atualize a página e faça login novamente.",
  [ERROR_IDS.GMAIL_GRANT_REVOKED]:
    "O Google desconectou esta caixa de entrada. Reconecte-a em Configurações e envie novamente.",
  [ERROR_IDS.GMAIL_TOKEN_DECRYPT_FAILED]:
    "Não foi possível ler as credenciais salvas desta caixa de entrada. Um administrador precisa reconectá-la.",
  [ERROR_IDS.GMAIL_ATTACHMENT_DENIED]:
    "Não foi possível ler um anexo. Remova-o e anexe o arquivo novamente.",
  [ERROR_IDS.GMAIL_SEND_INPUT_INVALID]:
    "Algo nesta mensagem foi rejeitado antes do envio. Verifique os destinatários e o assunto.",
  [ERROR_IDS.GMAIL_API_EXHAUSTED]: STRINGS.inbox.errorSend,
};

export function sendFailureMessage(errorId: string): string {
  return MESSAGES[errorId] ?? STRINGS.inbox.errorSend;
}
