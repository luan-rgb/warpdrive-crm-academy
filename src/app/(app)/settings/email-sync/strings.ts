// Co-located copy for the Email sync settings page. Kept out of the global src/constants/strings.ts
// so that shared file stays within its size budget; this page is the only consumer.
export const EMAIL_SYNC_STRINGS = {
  title: "Sincronização de e-mail",
  intro: "Conecte sua caixa do Google Workspace para sincronizar e-mails com o Warpdrive.",
  statusConnected: "Conectado",
  statusDisconnected: "Desconectado",
  statusError: "Precisa de atenção",
  statusStalled: "Não sincronizando",
  stalledHint:
    "Nenhum e-mail novo chegou há um tempo. Reconecte a caixa de entrada se isso não se resolver por conta própria.",
  connectedAs: (email: string) => `Conectado como ${email}`,
  notConnected: "Nenhuma caixa de entrada conectada ainda.",
  lastSynced: (when: string) => `Última sincronização em ${when}`,
  neverSynced: "Ainda não sincronizado",
  lastErrorLabel: "Último erro",
  connect: "Conectar Gmail",
  reconnect: "Reconectar",
  disconnect: "Desconectar",
  connecting: "Conectando...",
  disconnecting: "Desconectando...",
  actionError: "Não foi possível concluir essa ação. Tente novamente.",
  requiresAuth: "Faça login para ver esta página.",
} as const;
