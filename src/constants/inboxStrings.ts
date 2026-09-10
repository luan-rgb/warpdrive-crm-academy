// Copy for the mail Inbox / reader (thread list, composer chrome, follow-up controls).
// Extracted from strings.ts to keep that file under the 300-line hard cap; referenced as
// STRINGS.inbox.
export const INBOX_STRINGS = {
  title: "Caixa de entrada",
  // Full-pane compose route (/inbox/compose): page heading, metadata title, and the
  // folder-rail "New email" launch control all share this one label (Pipedrive parity).
  composeTitle: "Novo e-mail",
  // Shown in place of the composer while resuming a draft (?draft=<id>) and the drafts.list
  // query that supplies its seed is still in flight (ComposePageClient). Prevents an
  // interactive blank composer from mounting and then remounting once the draft arrives,
  // which would discard any edits the user started during that window.
  loadingDraft: "Carregando rascunho...",
  filterAll: "Todos",
  filterUnmatched: "Sem correspondência",
  filterNeedsLinking: "Precisa vincular",
  noThreads: "Nenhuma conversa encontrada.",
  // Inbox pages 50 threads at a time (INBOX_PAGE_SIZE), matching the People/Orgs lists.
  loadMore: "Carregar mais",
  loadingMore: "Carregando...",
  searchLabel: "Buscar e-mail",
  searchPlaceholder: "Buscar e-mail...",
  showRemoteContent: "Mostrar conteúdo remoto",
  composerPlaceholder: "Escreva sua resposta...",
  send: "Enviar",
  replyAction: "Responder",
  replyAllAction: "Responder a todos",
  forwardAction: "Encaminhar",
  // Sidebar link panel (search-to-link + create-and-auto-link, Pipedrive parity).
  sidebarContactHeading: "Contato",
  sidebarDealHeading: "Negócio",
  linkExisting: "Vincular a existente",
  changeLink: "Alterar",
  createContact: "Criar novo contato",
  addNewDeal: "Adicionar novo negócio",
  searchPeoplePlaceholder: "Buscar pessoas...",
  searchDealsPlaceholder: "Buscar negócios...",
  noMatches: "Nenhuma correspondência.",
  viewContact: "Ver contato",
  viewDeal: "Ver negócio",
  // Full-pane compose sidebar (Pipedrive parity): links a not-yet-sent draft to a deal so the
  // NEW thread carries that deal at send time (composer/ComposeLinkSidebar.tsx). Distinct from
  // sidebarDealHeading above, which titles the reader's post-send link panel.
  // PD titles this "Link to a deal, lead or project"; warpdrive has no Projects (out of scope), so
  // the heading + helper cover deal and lead only.
  linkDealSidebarHeading: "Vincular a um negócio ou lead",
  linkDealSidebarHelper: "Busque um negócio ou lead existente, ou crie um novo.",
  unlinkDeal: "Desvincular",
  // Fallbacks for the reader's linked-record chips when the name/title didn't load (never the
  // type noun "Person"/"Deal", which reads as a placeholder).
  linkedPersonFallback: "Contato vinculado",
  linkedDealFallback: "Negócio vinculado",
  errorSend: "Falha ao enviar. Tente novamente.",
  errorMarkUnread: "Falha ao marcar como não lida. Tente novamente.",
  markAsUnread: "Marcar como não lida",
  // Reader top bar (Back link + Archive action) and the row attachment indicator.
  back: "Voltar",
  backToInbox: "Voltar para a caixa de entrada",
  previousConversation: "Conversa anterior",
  nextConversation: "Próxima conversa",
  archive: "Arquivar",
  delete: "Excluir",
  deleteConfirmTitle: "Mover esta conversa para a Lixeira?",
  deleteConfirmBody: "Ela vai para a Lixeira do seu Gmail.",
  deleteConfirmAction: "Mover para a Lixeira",
  deleteCancel: "Cancelar",
  hasAttachmentLabel: "Tem anexo",
  // Quick-filters row (P2): attachment/unread toggles + date-range preset + Clear.
  unreadOnlyLabel: "Somente não lidas",
  dateRangeLabel: "Período",
  dateRangeAny: "Qualquer período",
  dateRange7d: "Últimos 7 dias",
  dateRange30d: "Últimos 30 dias",
  clearFilters: "Limpar",
  followUpStatusLabel: "Acompanhamento",
  errorSetFollowUpStatus: "Falha ao definir o status de acompanhamento. Tente novamente.",
  errorSetLabels: "Falha ao atualizar as etiquetas. Tente novamente.",
  errorCreateLabel: "Não foi possível criar a etiqueta. Tente novamente.",
  addLabel: "+ Adicionar etiqueta",
  searchOrCreateLabel: "Buscar ou criar uma etiqueta",
  createLabel: (name: string): string => `Criar "${name}"`,
  followUpStatusNames: {
    none: "Nenhum",
    waiting: "Esperando",
    replied: "Respondido",
    closed: "Encerrado",
  },
  labelNames: {
    important: "Importante",
    to_do: "A fazer",
    later: "Depois",
  },
  // Persisted per-message open/click history (source of record), rendered under each
  // outbound message in the reader. Distinct from the transient WS badge in the thread
  // header, which only nudges for the current session.
  trackingOpened: (n: number): string => `Aberto ${n} ${n === 1 ? "vez" : "vezes"}`,
  trackingClicked: (n: number): string => `Clicado ${n} ${n === 1 ? "vez" : "vezes"}`,
  // Timeline email cards on the deal and person records. Mailbox triage stays in the Inbox,
  // which "Open in Inbox" reaches; a record surface offers compose modes plus unlink.
  timelineMoreActions: "Mais ações de e-mail",
  openInInbox: "Abrir na Caixa de entrada",
  unlinkFromDeal: "Desvincular do negócio",
  unlinkFromPerson: "Desvincular da pessoa",
  unlinkConfirmTitle: "Desvincular esta conversa?",
  unlinkConfirmBody:
    "Toda mensagem desta conversa sai da linha do tempo deste registro. A conversa continua na sua Caixa de entrada.",
  unlinkConfirmAction: "Desvincular",
  expandEmail: "Expandir e-mail",
  collapseEmail: "Recolher e-mail",
  emailBodyFailed: "Não foi possível carregar este e-mail.",
  retry: "Tentar novamente",
  loadingEmail: "Carregando e-mail...",
  // Stand in for the Email filter's empty line while a record's linked-message read is in flight or
  // after it failed, when there is no empty result to report yet.
  loadingEmails: "Carregando e-mails...",
  emailListFailed: "Não foi possível carregar os e-mails. Tente novamente.",
} as const;
