// Co-located copy for the Email sync settings page. Kept out of the global src/constants/strings.ts
// so that shared file stays within its size budget; this page is the only consumer.
export const EMAIL_SYNC_STRINGS = {
  title: "Sincronização de e-mail",
  intro:
    "Conecte sua caixa de e-mail (Gmail, Outlook ou qualquer provedor com IMAP/SMTP) para enviar e receber e-mails dentro do CRM.",
  cardTitle: "Conexão de e-mail",
  cardDescription: "Uma caixa por usuário. Tudo gratuito, sem limite de contas.",
  statusConnected: "Conectado",
  statusDisconnected: "Desconectado",
  statusError: "Precisa de atenção",
  statusStalled: "Não sincronizando",
  stalledHint:
    "Nenhum e-mail novo chegou há um tempo. Reconecte a caixa de entrada se isso não se resolver por conta própria.",
  connectedAs: (email: string, provider: string) => `Conectado como ${email} (${provider})`,
  notConnected: "Nenhuma caixa de entrada conectada ainda.",
  lastSynced: (when: string) => `Última sincronização em ${when}`,
  neverSynced: "Ainda não sincronizado",
  lastErrorLabel: "Último erro",
  chooseProvider: "Escolha como conectar:",
  connectGmail: "Conectar Gmail",
  connectOutlook: "Conectar Outlook",
  connectOther: "Outro provedor (IMAP/SMTP)",
  gmailHint: "Contas Gmail e Google Workspace.",
  outlookHint: "Outlook.com, Hotmail, Live e Microsoft 365.",
  otherHint: "Yahoo, iCloud, UOL, Terra, Zoho, e-mail da sua hospedagem e outros.",
  disconnect: "Desconectar",
  connecting: "Conectando...",
  disconnecting: "Desconectando...",
  actionError: "Não foi possível concluir essa ação. Tente novamente.",
  requiresAuth: "Faça login para ver esta página.",
  nylasRetired:
    "Sua caixa foi conectada pelo sistema antigo, que foi desativado. Ela precisa ser reconectada: escolha uma opção abaixo. Os e-mails já sincronizados continuam no CRM.",
  connectedNotice:
    "Caixa de e-mail conectada com sucesso. A primeira sincronização começa em instantes.",
  errorNotices: {
    denied: "A conexão foi cancelada na tela do Google/Microsoft. Nada foi alterado.",
    taken: "Este endereço de e-mail já está conectado por outro usuário deste CRM.",
    no_refresh_token:
      "O provedor não concedeu acesso contínuo. Tente de novo e aceite todas as permissões pedidas.",
    exchange: "O provedor recusou a conexão. Tente novamente em alguns minutos.",
    identity: "Não foi possível confirmar o endereço de e-mail da conta. Tente novamente.",
    tenant: "Não foi possível concluir a conexão neste CRM. Avise o suporte.",
  } as Record<string, string>,
  genericErrorNotice: "Não foi possível conectar a caixa de e-mail. Tente novamente.",
  providerLabels: { gmail: "Gmail", outlook: "Outlook", imap: "IMAP/SMTP" },
  imap: {
    title: "Conectar outro provedor (IMAP/SMTP)",
    description:
      "Informe os dados do seu provedor. Testamos o acesso antes de salvar, e a senha fica criptografada.",
    preset: "Provedor",
    presetPlaceholder: "Escolha para preencher os servidores",
    custom: "Personalizado",
    email: "E-mail",
    username: "Usuário",
    password: "Senha",
    appPasswordHint:
      "Este provedor exige uma senha de app (criada nas configurações de segurança da sua conta), não a sua senha normal.",
    imapHost: "Servidor IMAP",
    imapPort: "Porta IMAP",
    smtpHost: "Servidor SMTP",
    smtpPort: "Porta SMTP",
    secure: "Conexão segura direta (SSL/TLS)",
    secureHint: "Desligado usa STARTTLS (portas 143/587). A conexão é sempre criptografada.",
    submit: "Testar e conectar",
    submitting: "Testando conexão...",
    cancel: "Cancelar",
    loginFailed:
      "Não conseguimos entrar no servidor. Confira servidor, porta, usuário e senha. Muitos provedores exigem uma senha de app.",
    invalid: "Preencha todos os campos corretamente.",
  },
} as const;
