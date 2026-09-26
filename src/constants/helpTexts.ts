// Central catalogue of the "?" help popovers (components/ui/help-tooltip.tsx). One entry per
// topic, keyed "<area>.<thing>", so no explanation text is scattered through the UI and the same
// feature reads the same everywhere. Keep bodies to a short paragraph in plain Portuguese.
export interface HelpText {
  title: string;
  body: string;
}

export const HELP_TEXTS = {
  // Funil / pipeline
  "pipeline.board": {
    title: "Funil de vendas",
    body: "Cada coluna é uma etapa do seu processo de vendas. Arraste um negócio de uma coluna para a outra quando ele avançar. O total no topo de cada coluna soma o valor dos negócios abertos naquela etapa.",
  },
  "pipeline.switcher": {
    title: "Vários funis",
    body: "Você pode ter um funil para cada tipo de venda (por exemplo, um para novos clientes e outro para renovações). Troque de funil aqui; cada um tem as suas próprias etapas.",
  },
  "pipeline.stages": {
    title: "Etapas do funil",
    body: "As etapas são os passos que um negócio percorre até ser ganho. A probabilidade de cada etapa é usada na previsão de receita do painel.",
  },
  "pipeline.rotting": {
    title: "Negócios parados",
    body: "Defina quantos dias um negócio pode ficar numa etapa sem atividade. Depois desse prazo o cartão fica destacado em vermelho no funil, para você não esquecer de dar o próximo passo.",
  },
  "pipeline.filters": {
    title: "Filtros",
    body: "Mostre só os negócios que interessam agora: por responsável, etapa, valor, etiqueta ou data prevista. Salve um filtro para reutilizá-lo depois com um clique.",
  },
  "pipeline.views": {
    title: "Quadro ou lista",
    body: "O quadro mostra os negócios como cartões por etapa. A lista mostra os mesmos negócios em tabela, com colunas que você escolhe, boa para revisar muitos de uma vez.",
  },
  // Negócios
  "deal.value": {
    title: "Valor do negócio",
    body: "Quanto este negócio vale em reais se for ganho. É somado nos totais do funil, na previsão de receita e nas metas de valor.",
  },
  "deal.expectedClose": {
    title: "Data prevista de fechamento",
    body: "Quando você espera fechar este negócio. É usada na previsão de receita do painel para distribuir o valor pelos meses.",
  },
  "deal.stage": {
    title: "Etapa atual",
    body: "Em que ponto do funil o negócio está. Clique numa etapa da barra para movê-lo; a mudança fica registrada no histórico.",
  },
  "deal.status": {
    title: "Ganho ou perdido",
    body: "Marque o negócio como ganho quando fechar a venda ou como perdido (com o motivo) quando não der certo. Negócios fechados saem do funil e alimentam as taxas de conversão do painel.",
  },
  "deal.owner": {
    title: "Responsável",
    body: "A pessoa da equipe que cuida deste negócio. Ela recebe as notificações e aparece nos relatórios e metas individuais.",
  },
  "deal.labels": {
    title: "Etiquetas",
    body: "Marcadores coloridos para agrupar negócios (por exemplo: quente, frio, indicação). Dá para filtrar o funil e as listas por etiqueta.",
  },
  "deal.source": {
    title: "Origem",
    body: "De onde veio este negócio (indicação, site, evento...). Ajuda a descobrir quais canais trazem mais vendas.",
  },
  "deal.products": {
    title: "Produtos do negócio",
    body: "Adicione itens do catálogo com quantidade, preço e desconto. O total dos produtos pode ser usado como valor do negócio e nas faturas.",
  },
  "deal.participants": {
    title: "Participantes",
    body: "Outras pessoas de contato envolvidas neste negócio além do contato principal, por exemplo quem decide ou quem paga.",
  },
  "deal.history": {
    title: "Histórico",
    body: "Tudo o que aconteceu com o negócio em ordem: anotações, atividades, e-mails e alterações de campos. Use as abas para ver só um tipo.",
  },
  "deal.followers": {
    title: "Seguidores",
    body: "Quem segue um negócio recebe notificações quando ele muda, mesmo sem ser o responsável.",
  },
  // Leads
  "lead.inbox": {
    title: "Caixa de leads",
    body: "Leads são oportunidades ainda não qualificadas. Revise-os aqui e converta em negócio quando fizer sentido entrar no funil, sem poluir o funil com contatos frios.",
  },
  "lead.convert": {
    title: "Converter em negócio",
    body: "Transforma o lead em um negócio no funil escolhido, levando junto contato, organização, anotações e atividades.",
  },
  // Contatos e organizações
  "contact.people": {
    title: "Pessoas",
    body: "Todos os seus contatos. Cada pessoa pode estar ligada a uma organização e a vários negócios, e tem seu próprio histórico de e-mails e atividades.",
  },
  "contact.timeline": {
    title: "Linha do tempo de contatos",
    body: "Mostra quando você falou pela última vez com cada contato e o que está agendado, para ninguém ficar esquecido.",
  },
  "contact.merge": {
    title: "Mesclar duplicados",
    body: "Junta dois registros da mesma pessoa ou empresa em um só, mantendo negócios, atividades e e-mails dos dois.",
  },
  "org.list": {
    title: "Organizações",
    body: "As empresas com quem você negocia. Pessoas e negócios ligados a uma organização aparecem juntos na página dela.",
  },
  // Atividades
  "activity.list": {
    title: "Atividades",
    body: "Ligações, reuniões, tarefas e prazos. Agende sempre a próxima atividade de cada negócio: é o que mantém o funil andando.",
  },
  "activity.calendar": {
    title: "Calendário",
    body: "As mesmas atividades vistas por semana ou por mês. Clique num horário vazio para agendar uma nova.",
  },
  "activity.types": {
    title: "Tipos de atividade",
    body: "Os tipos que aparecem ao criar uma atividade (ligação, reunião, e-mail...). Personalize nome e ícone para o jeito que a sua equipe trabalha.",
  },
  // E-mail
  "email.sync": {
    title: "Sincronização de e-mail",
    body: "Conecte sua caixa para enviar e receber e-mails dentro do CRM. As conversas com seus contatos aparecem automaticamente no histórico dos negócios.",
  },
  "email.gmail": {
    title: "Conectar Gmail",
    body: "Entra com a sua conta Google. Se aparecer o aviso de app não verificado, clique em Avançado e continue. Alternativa sem aviso: use Outro provedor com uma senha de app do Google.",
  },
  "email.outlook": {
    title: "Conectar Outlook",
    body: "Funciona com Outlook.com, Hotmail, Live e Microsoft 365. Você entra com a conta Microsoft e autoriza o acesso aos e-mails.",
  },
  "email.imap": {
    title: "Outro provedor (IMAP/SMTP)",
    body: "Para qualquer outro e-mail (Yahoo, UOL, e-mail da sua hospedagem...). Informe os servidores e a senha; muitos provedores exigem uma senha de app. Testamos o acesso antes de salvar.",
  },
  "email.inbox": {
    title: "Caixa de entrada",
    body: "Seus e-mails sincronizados. Vincule uma conversa a um negócio ou contato para que ela apareça no histórico dele.",
  },
  "email.templates": {
    title: "Modelos e assinaturas",
    body: "Textos prontos para os e-mails que você manda sempre, com campos como {{person.first_name}} preenchidos automaticamente.",
  },
  "email.tracking": {
    title: "Rastreamento de abertura",
    body: "Avisa quando o destinatário abre o e-mail ou clica num link. Pode ser ligado ou desligado para toda a empresa.",
  },
  // Automações
  "automation.list": {
    title: "Automações",
    body: "Regras que fazem o trabalho repetitivo sozinhas: quando algo acontece (gatilho), se as condições baterem, o CRM executa as ações.",
  },
  "automation.trigger": {
    title: "Gatilho",
    body: "O evento que dispara a automação, por exemplo um negócio criado, uma mudança de etapa, um negócio ganho ou uma atividade concluída.",
  },
  "automation.conditions": {
    title: "Condições",
    body: "Filtros opcionais: a automação só roda se todas as condições forem verdadeiras (por exemplo, valor maior que R$ 10.000 ou funil específico).",
  },
  "automation.actions": {
    title: "Ações",
    body: "O que o CRM faz quando a regra dispara: criar atividade, enviar e-mail, notificar alguém, mudar campo, adicionar anotação ou chamar um webhook. Executadas em ordem.",
  },
  "automation.history": {
    title: "Histórico de execuções",
    body: "Cada vez que a automação rodou, com o resultado de cada ação. Use para conferir se ela está funcionando ou entender um erro.",
  },
  // Painel
  "dashboard.overview": {
    title: "Painel",
    body: "Os números do seu processo de vendas: negócios ganhos, taxa de conversão, previsão de receita e metas. Filtre por período, funil ou pessoa.",
  },
  "dashboard.funnel": {
    title: "Conversão do funil",
    body: "Quantos negócios passaram por cada etapa. Uma queda grande entre duas etapas mostra onde as vendas estão travando.",
  },
  "dashboard.forecast": {
    title: "Previsão de receita",
    body: "Soma dos negócios abertos pela data prevista de fechamento. O valor ponderado multiplica cada negócio pela probabilidade da etapa em que está.",
  },
  "dashboard.winRate": {
    title: "Taxa de ganho",
    body: "De todos os negócios fechados no período, quantos foram ganhos. Negócios ainda abertos não entram na conta.",
  },
  "dashboard.performance": {
    title: "Desempenho dos negócios",
    body: "Quantos negócios foram criados, ganhos e perdidos no período, com o valor de cada grupo.",
  },
  "dashboard.wonTrend": {
    title: "Evolução das vendas",
    body: "Negócios ganhos mês a mês. Ajuda a ver sazonalidade e se as vendas estão crescendo.",
  },
  "dashboard.activities": {
    title: "Atividades no período",
    body: "Quantas atividades foram agendadas e concluídas. Mais atividade costuma significar mais vendas.",
  },
  "dashboard.activityTypes": {
    title: "Atividades por tipo",
    body: "Como a equipe distribui o tempo entre ligações, reuniões, e-mails e tarefas.",
  },
  "dashboard.lostReasons": {
    title: "Motivos de perda",
    body: "Por que os negócios foram perdidos, para você atacar o motivo mais frequente.",
  },
  "dashboard.stageSums": {
    title: "Valor por etapa",
    body: "Quanto dinheiro está parado em cada etapa do funil agora.",
  },
  "dashboard.goals": {
    title: "Metas",
    body: "O progresso de cada meta ativa no período atual.",
  },
  // Metas, produtos, campos, importação
  "goal.list": {
    title: "Metas",
    body: "Defina alvos de quantidade ou valor (negócios ganhos, atividades concluídas...) para a empresa, uma equipe ou uma pessoa, e acompanhe no painel.",
  },
  "product.catalog": {
    title: "Catálogo de produtos",
    body: "Os produtos e serviços que você vende, com preço padrão. Eles podem ser adicionados aos negócios e às faturas.",
  },
  "field.custom": {
    title: "Campos personalizados",
    body: "Crie campos próprios (texto, número, data, lista...) para guardar informações que o CRM não tem de fábrica, em negócios, pessoas, organizações ou leads.",
  },
  "import.csv": {
    title: "Importar planilha",
    body: "Traga contatos, organizações, negócios ou atividades de uma planilha CSV. Você confere o mapeamento das colunas antes e pode desfazer a importação depois.",
  },
  // Configurações
  "settings.profile": {
    title: "Seu perfil",
    body: "Seu nome, foto e preferências pessoais. Só afetam a sua conta.",
  },
  "settings.notifications": {
    title: "Notificações",
    body: "Escolha o que você quer ser avisado e por onde (no sino do CRM ou por e-mail).",
  },
  "settings.connections": {
    title: "Apps conectados",
    body: "As integrações ativas na sua conta: caixa de e-mail, assistentes de IA (como o Claude) e outros apps autorizados. Revogue o que não usar mais.",
  },
  "settings.company": {
    title: "Empresa",
    body: "Configurações que valem para todos: dados da empresa, etiquetas, motivos de perda, tipos de atividade e funis.",
  },
  "settings.users": {
    title: "Usuários",
    body: "Convide pessoas da equipe, defina quem é administrador e desative quem saiu. Cada usuário tem a sua própria caixa de e-mail.",
  },
  "settings.teams": {
    title: "Equipes",
    body: "Agrupe usuários em equipes para metas e relatórios por equipe.",
  },
  "settings.permissions": {
    title: "Conjuntos de permissões",
    body: "Definem o que cada usuário pode fazer: excluir registros, exportar, gerenciar automações e assim por diante.",
  },
  "settings.visibility": {
    title: "Grupos de visibilidade",
    body: "Definem quem pode ver quais registros, para separar a carteira de cada vendedor ou equipe.",
  },
  "settings.enrichment": {
    title: "Enriquecimento de dados",
    body: "Completa dados de contatos e empresas (cargo, telefone, setor...) usando provedores externos com a sua própria chave de API.",
  },
  "settings.labels": {
    title: "Etiquetas",
    body: "A lista de etiquetas disponíveis para negócios, leads, pessoas e organizações.",
  },
  "settings.lostReasons": {
    title: "Motivos de perda",
    body: "As opções que aparecem ao marcar um negócio como perdido. Entender por que você perde vendas é o primeiro passo para perder menos.",
  },
} as const satisfies Record<string, HelpText>;

export type HelpTopic = keyof typeof HELP_TEXTS;
