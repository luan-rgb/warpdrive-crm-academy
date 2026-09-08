export const DEAL_SIDEBAR_STRINGS = {
  sections: {
    summary: "Resumo",
    details: "Detalhes",
    source: "Origem",
    products: "Produtos",
    invoices: "Faturas",
    person: "Pessoa",
    participants: "Participantes",
    organization: "Organização",
    overview: "Visão geral",
  },
  menu: {
    editSection: (section: string) => `Editar seção ${section}`,
    sectionOptions: (section: string) => `Opções de ${section}`,
    fillGaps: "Preencher os campos vazios",
    switchOrganization: "Trocar para outra organização",
    unlinkOrganization: "Desvincular esta organização",
    customizeFields: "Personalizar campos",
    customizeSummary: "Personalizar Resumo",
    manageSections: "Gerenciar seções da barra lateral",
  },
  emptyState: {
    // Shown in the Details section when the deal entity has no custom fields defined, instead of a
    // blank box (read) or an editor with only Cancel/Save and no fields (bulk edit).
    details: "Nenhum campo personalizado ainda. Adicione em Personalizar campos.",
  },
  orgDialog: {
    title: "Trocar organização",
    organization: "Organização",
    save: "Salvar",
    cancel: "Cancelar",
  },
} as const;
