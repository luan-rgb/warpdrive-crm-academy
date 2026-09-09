// Co-located copy for the Email templates + signatures settings page. Kept out of the global
// src/constants/strings.ts so that shared file stays within its size budget; this page is the
// only consumer. The nav label reuses the existing STRINGS.settings.emailTemplates.
export const EMAIL_SETTINGS_STRINGS = {
  description: "Gerencie modelos e assinaturas reutilizáveis para e-mails enviados.",
  templates: "Modelos",
  signatures: "Assinaturas",
  newTemplate: "Novo modelo",
  newSignature: "Nova assinatura",
  shareWithTeam: "Compartilhar com a equipe",
  setDefault: "Definir como padrão",
  defaultBadge: "Padrão",
  sharedBadge: "Compartilhado",
  nameLabel: "Nome",
  nameRequired: "Digite um nome antes de salvar.",
  maxNameHint: "Máx. 40 caracteres",
  subjectLabel: "Assunto",
  bodyLabel: "Corpo",
  save: "Salvar",
  cancel: "Cancelar",
  edit: "Editar",
  delete: "Excluir",
  empty: "Nada aqui ainda.",
  // T2 search + T4 management-table columns and bulk controls.
  searchTemplates: "Buscar modelos",
  createdOnHeader: "Criado",
  ownerHeader: "Responsável",
  nameHeader: "Nome",
  you: "Você",
  select: "Selecionar",
  selectAll: "Selecionar todos os modelos",
  deleteSelected: "Excluir selecionados",
  reorder: "Reordenar",
} as const;
