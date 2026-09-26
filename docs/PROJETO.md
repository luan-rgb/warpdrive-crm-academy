# CRM Academy no warpdrive: doc-mestre

Documento de estado, não de arquitetura de referência (isso é `docs/deploy-multi-tenant.md` e
`docs/superpowers/specs/2026-09-05-multi-tenant-provisioning-design.md`, ambos ainda válidos).
Este arquivo existe pra alguém (você, ou uma sessão futura do Claude) entender rápido **o que
existe hoje, por que, e onde mexer** sem precisar reconstruir o histórico de decisões. Atualize-o
sempre que algo aqui descrito mudar de verdade.

Última atualização: 2026-09-26.

## O que é isto

`warpdrive-crm-academy` (fork de `sneg55/warpdrive`) hospedado em modo **multi-tenant** nesta VPS
(`179.197.74.109`): cada aluno da CRM Academy recebe um CRM warpdrive isolado (banco, bucket,
containers próprios) em `<slug>.crm.estrategistacrm.com.br`, provisionado **automaticamente**
quando uma compra na Hotmart completa 7 dias (fim da garantia).

Você também tem uma conta pessoal provisionada do mesmo jeito: **estrategistacrm** →
`https://estrategistacrm.crm.estrategistacrm.com.br` (login: `luan@estrategistacrm.com.br` via
magic-link). Não é um aluno, é o seu uso próprio pra vender os produtos da Estrategista, mesmo
mecanismo, só que criado manualmente por mim em vez de vir de uma compra.

## Como uma conta nasce (visão de 30 segundos)

```
Hotmart (compra) ──webhook──▶ crm-hotmart (Supabase Edge Function, já existia)
                                  │ valida hottok, grava em crm_compras
                                  │ (produto = "CRM Academy" → entregar_em = +7 dias)
                                  ▼
                          crm_compras (Postgres do Supabase principal)
                                  ▲
                                  │ 1x/dia, 04:00 (cron)
scripts/hotmart-lifecycle.sh ─────┘
   • entregar_em passou?  → provision-tenant.sh, e-mail com a URL
   • reembolso/cancelou?  → docker compose stop (nunca apaga)
   • venceu o ano grátis? → docker compose stop (nunca apaga)
   • vence em 30 dias?    → e-mail de aviso
```

`crm-hotmart` já existia antes deste trabalho e **não foi tocado** (ele lida com Clube do Livro e
Imersão também, via outras funções). O que este trabalho fez foi apontar a entrega de CRM Academy
especificamente pra um tenant warpdrive em vez do sistema antigo de código de ativação, e excluir
CRM Academy do cron antigo (`crm-entregar`) pra não ter dois sistemas entregando a mesma compra.

## Peças e onde elas vivem

| Peça | Onde | O que faz |
|---|---|---|
| Stack compartilhada (Postgres/MinIO/Caddy) | `~/warpdrive`, `docker compose -p tenants-shared` | Um Postgres e um MinIO servindo todos os alunos; Caddy roteia por subdomínio |
| Config de cada aluno | `~/warpdrive/envs/aluno-<slug>.env` | Gerado por `provision-tenant.sh`, nunca versionado (segredos reais) |
| `envs/shared.env` | `~/warpdrive/envs/shared.env` | Segredos da stack: senhas do Postgres/MinIO, `RESEND_API_KEY`, `MAGIC_LINK_FROM_EMAIL`, apps OAuth de e-mail (`GMAIL_OAUTH_*`, `MICROSOFT_OAUTH_*`, `MAIL_OAUTH_RELAY_SECRET`). `GOOGLE_OAUTH_*` ficam vazias de propósito (login é por magic-link) |
| Roteamento por subdomínio | `~/warpdrive/caddy/Caddyfile.tenants` | Um bloco por aluno, entre marcadores `BEGIN/END TENANT`. **Nunca edite à mão**, só via provision/deprovision |
| TLS | nginx do host (`/etc/nginx/sites-available/warpdrive-tenants`) | Termina TLS com o wildcard `*.crm.estrategistacrm.com.br` (acme.sh/DNS-01) e repassa pro Caddy interno |
| Provisionar aluno | `scripts/provision-tenant.sh <slug> <email>` | Banco + bucket + containers + bloco Caddy |
| Remover aluno (destrutivo) | `scripts/deprovision-tenant.sh <slug> --yes-delete-data` | Some com tudo. Só rode se tiver certeza |
| Suspender (não-destrutivo) | `docker compose -p aluno-<slug> -f docker-compose.tenant.yml --env-file envs/aluno-<slug>.env stop` | O que o cron faz sozinho; dá pra rodar à mão também |
| Ciclo de vida Hotmart | `scripts/hotmart-lifecycle.sh` | Cron diário (04:00), ver acima |
| Backup | `scripts/backup-tenants.sh` | Cron diário (03:17): `pg_dumpall` + volume MinIO + `envs/` + limpeza de imagens/cache órfãos, retenção 7 dias, em `/opt/backups/warpdrive-tenants/` |
| Relay de e-mail (OAuth) | `mail-oauth-relay/`, container `shared-mail-oauth-relay` | Dono dos redirect_uri do Google/Microsoft pra todos os alunos (ver seção de e-mail) |
| Login por e-mail | `src/features/auth/magicLink.ts` + `magicLinkEmail.ts` | Reaproveita o Resend já configurado; alternativa ao Google OAuth (que não escala por subdomínio) |
| Registro de compras/tenants | Tabela `crm_compras` no Postgres principal do Supabase (`supabase-db`) | **Não é um banco novo**, reaproveita a tabela que `crm-hotmart` já escrevia, com colunas novas `warpdrive_*` |

## Perguntas que você provavelmente vai ter

**"Um aluno some da lista, o que faço?"** Veja `crm_compras.warpdrive_status`
(`pendente`/`provisionado`/`suspenso`) e `status` (`aprovada`/`cancelada`/`reembolsada`) via
`docker exec supabase-db psql -U postgres -d postgres -c "SELECT * FROM crm_compras WHERE comprador_email = '...'"`.

**"Quero reativar um aluno suspenso (reembolso revertido, ano renovado etc)."** Não existe script
pronto pra isso ainda, hoje é manual: `docker compose -p aluno-<slug> ... up -d` pra religar os
containers, e atualizar `warpdrive_status`/`warpdrive_expires_at` na mesma linha de `crm_compras`.
Se isso virar rotina, vale um `scripts/reactivate-tenant.sh`.

**"Um aluno perdeu acesso ao e-mail que usa pra entrar."** Login é só magic-link (sem senha, sem
"esqueci minha senha"): perder o e-mail é perder o único jeito de entrar, e não tem
auto-recuperação dentro do app. `scripts/reset-tenant-login-email.sh <slug> <email-antigo>
<email-novo>` resolve, troca o e-mail (e o `google_sub` sintético junto, tem que ser os dois ou
o próximo login cria uma conta nova em vez de reconhecer a pessoa) na conta existente do aluno,
sem apagar nada dela. Confirme que é mesmo o aluno pedindo (cruze com `crm_compras` ou o e-mail da
compra original) antes de rodar, o script não verifica identidade por você. Só funciona pra quem
loga por magic-link; alguém que usa Google OAuth recupera pelo próprio Google.

**"Quero mudar quanto tempo depois do vencimento ele é suspenso, ou o aviso de 30 dias."** Edite
as constantes no topo de `scripts/hotmart-lifecycle.sh` (`interval '30 days'` etc.) e o `+365 days`
na seção de entrega.

**"O cron roda de quanto em quanto tempo? Por que um aluno não apareceu na hora?"** Uma vez por
dia, 04:00. Alguém que completa os 7 dias às 04:01 só é liberado ~24h depois. Se quiser mais
precisão, troque `0 4 * * *` por `0 * * * *` no crontab (`crontab -e`) pra rodar de hora em hora , 
o script é idempotente, não tem problema rodar mais vezes.

**"Quantos alunos cabem nesta VPS?"** Medido em 2026-09-21: **~6-8 tenants simultâneos**, 2 vCPU e
~7.8GB de RAM já divididos com seus outros produtos (Supabase, Chatwoot, AFFiNE, Excalidraw...).
Não bloqueia começar, bloqueia crescer, se a turma passar disso, ou aumenta a RAM desta VPS, ou
migra algum produto pra outro lugar antes de continuar vendendo.

**"Onde estão os segredos?"** `envs/shared.env` (permissão 600, fora do git). O `RESEND_API_KEY`
foi reaproveitado da conta que já existia pro Twenty CRM (mesmo domínio verificado
`estrategistacrm.com.br`), se aquela conta Resend for encerrada um dia, isso quebra o envio de
e-mail daqui também.

## Bugs reais encontrados e corrigidos nesta rodada (2026-09-21 a 25)

Ficam registrados aqui porque não são óbvios e podem se repetir se alguém "simplificar" o código
sem saber o porquê:

1. **`minio/minio` e `minio/mc` pararam de aceitar pull anônimo no Docker Hub.** Trocado pro
   mirror `quay.io/minio/*` em `docker-compose.shared.yml` e nos 3 scripts que usam `mc`.
2. **Caddy montado como arquivo único quebrava silenciosamente.** `deprovision-tenant.sh` edita o
   Caddyfile com `sed -i`, que troca o inode do arquivo; um bind mount de **arquivo** fica preso
   no inode antigo pra sempre depois disso, e `caddy reload` não resolve (só um recreate do
   container resolvia, manualmente). Corrigido trocando pra mount de **diretório**
   (`./caddy:/etc/caddy:ro`), que não tem esse problema. Isso já causou um apagão silencioso real
   (nenhum aluno provisionado entre os testes de 21/09 e a correção em 23/09 teria funcionado).
   **Reapareceu em 25/09** de um jeito diferente: `caddy/Caddyfile.tenants` continuava versionado
   no git, e um `git pull`/`checkout` reescreve o arquivo (novo inode) mesmo estando *dentro* de
   um diretório montado, o container voltou a ver o diretório vazio. Corrigido de vez tirando o
   arquivo do git (mesmo tratamento do `envs/shared.env`): agora é `caddy/Caddyfile.tenants.example`
   versionado + `caddy/Caddyfile.tenants` gitignorado, copiado uma vez no setup. Nunca mais um
   `git pull` toca nesse arquivo.
3. **Log do `hotmart-lifecycle.sh` duplicava cada linha.** O script já redireciona sua própria
   saída pra um `tee`; o crontab redirecionava de novo por fora. Corrigido removendo o
   redirecionamento externo no crontab (o script já cuida disso sozinho).
4. **Magic-link deixava qualquer e-mail se autocadastrar num tenant.** Achado ao vivo (o próprio
   usuário testou com um e-mail pessoal e ganhou uma conta real, não-admin, dentro do tenant
   `estrategistacrm`). Google OAuth tinha `GOOGLE_WORKSPACE_DOMAIN` como trava de graça; magic-link
   não tinha equivalente. Corrigido em `src/features/auth/magicLink.ts`
   (`isKnownToTenant`): só emite link pro seed admin ou pra quem já existe/foi convidado.

## E-mail gratuito: Gmail, Outlook e IMAP/SMTP (substituiu a Nylas, 2026-09-26)

A Nylas (25/09) funcionou, mas no plano grátis mostra uma tela de aviso de segurança pro aluno e
tem teto de 5 contas: inviável pra 20 a 50 alunos sem pagar. Foi trocada por **três conexões
diretas, gratuitas e sem limite de contas**, e todo o código Nylas foi removido.

**Como funciona**

- **Uma interface, três implementações.** Todo o sistema de e-mail (sync, envio, lixeira, anexos,
  automações, notificações) fala com a interface `GmailClient`. Agora há três implementações:
  `gmailClient.ts` (Gmail API), `outlookClient.ts` (Microsoft Graph) e `imapClient.ts`
  (IMAP com `imapflow`, SMTP com `nodemailer`, parse com `mailparser`). A coluna
  `email_accounts.provider` (`gmail | outlook | imap`) diz qual usar, e
  `src/features/email/clientFactory.ts` + `productionClient.ts` são o **único** lugar que decide
  isso. Nenhum ponto do sistema cria cliente direto (antes, envio interativo, anexos, e-mail de
  sistema e automações sempre criavam cliente Gmail e quebravam pra contas Nylas).
- **Gmail e Outlook (OAuth) passam pelo relay central `mail-oauth-relay/`** (serviço da stack
  compartilhada, mesma ideia do antigo `nylas-relay/`). Google e Microsoft só aceitam um
  redirect_uri fixo por app, e cada aluno tem um subdomínio. O tenant pede ao relay uma URL de
  consentimento (`POST /connect-init`, servidor-a-servidor, com o segredo
  `MAIL_OAUTH_RELAY_SECRET`); o relay gera um `state` de uso único (tabela
  `warpdrive_ops.mail_oauth_requests`, criada sozinha no primeiro boot), recebe o callback, troca o
  código, **criptografa o refresh token com a `TOKEN_ENCRYPTION_KEY` do próprio tenant** (lida de
  `envs/aluno-<slug>.env`, montado somente leitura) e grava em `email_accounts` no banco
  `aluno_<slug>` com o admin do Postgres compartilhado. Depois devolve o aluno pra
  `/settings/email-sync`, que dispara a primeira sincronização.
- **Outlook** usa o endpoint `common` (conta pessoal Outlook/Hotmail/Live e corporativa Microsoft
  365). IDs imutáveis do Graph mantêm a mesma mensagem com o mesmo id quando ela muda de pasta.
- **IMAP/SMTP** é pra qualquer outro provedor: o aluno preenche um formulário (com presets de
  Yahoo, iCloud, UOL, Terra, Zoho, Hostinger, Locaweb, KingHost e Gmail com senha de app). O login
  nos dois servidores é testado antes de salvar; a senha fica criptografada
  (`imap_password_enc`, mesmo AES-GCM do refresh token). TLS é sempre exigido (SSL direto ou
  STARTTLS). O Bcc é removido do MIME antes do SMTP (senão vazaria), e a cópia enviada é gravada na
  pasta Enviados (exceto no Gmail, que já faz isso sozinho).
- **Sincronização:** Gmail continua no cursor `historyId`. Outlook e IMAP usam
  `syncPolledMailbox` (a cada ~90s lista as mensagens recentes, baixa só as que ainda não estão no
  banco e reconcilia lixeira/spam das conversas que receberam mensagem nova).

**Contas que estavam conectadas pela Nylas (inclui o seu `estrategistacrm`)**

Um grant da Nylas não é um refresh token do Google/Microsoft, então não dá pra migrar a conexão
em si. A migração `0084_retire_nylas.sql` marca essas caixas como **desconectadas** com o erro
`E_MAIL_008` e apaga a coluna `nylas_grant_id`. **Nada é perdido:** a linha da conta, as threads e
as 50+ mensagens já sincronizadas continuam no CRM. A tela de sincronização mostra um aviso
("precisa ser reconectada") com as três opções; ao reconectar (pelo Gmail ou IMAP), o sistema
reaproveita a mesma conta (mesmo `user_id`). Observação: os ids das mensagens que vieram pela Nylas
são ids do próprio Gmail, então depois de reconectar pelo Gmail o sync não deve duplicar nada; se
reconectar por IMAP, mensagens antigas podem aparecer uma segunda vez (ids diferentes).

**O que você (dono) precisa fazer uma vez** (não dá pra automatizar: só o dono das contas pode
criar os apps)

1. **Google Cloud Console** (grátis): criar um projeto, ativar a **Gmail API**, configurar a tela
   de consentimento OAuth como **Externa** e colocar em **Produção** (em "Teste" o Google expira o
   refresh token em 7 dias). Criar credencial **ID do cliente OAuth → Aplicativo da Web** com o
   URI de redirecionamento exatamente
   `https://crm.estrategistacrm.com.br/api/mail-oauth/google/callback`. Escopos:
   `gmail.modify`, `gmail.send`, `openid`, `email`.
2. **Microsoft Entra ID / Azure** (grátis): *Registros de aplicativo → Novo registro*, tipo de
   conta "**contas em qualquer diretório organizacional e contas pessoais Microsoft**", URI de
   redirecionamento (Web)
   `https://crm.estrategistacrm.com.br/api/mail-oauth/microsoft/callback`. Em *Certificados e
   segredos* crie um segredo (**ele expira, no máximo em 24 meses: anote a data e renove**). Em
   *Permissões de API* (delegadas, Microsoft Graph): `Mail.ReadWrite`, `Mail.Send`, `User.Read`,
   `offline_access`, `openid`, `email`.
3. Em `envs/shared.env`: `GMAIL_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_CLIENT_ID/SECRET` e
   `MAIL_OAUTH_RELAY_SECRET` (`openssl rand -hex 32`). Pode remover as variáveis `NYLAS_*`.
4. **nginx** (`/etc/nginx/sites-available/warpdrive-tenants`, no bloco de
   `crm.estrategistacrm.com.br`): trocar a regra `/api/nylas/` por esta (só os callbacks ficam
   públicos; `/connect-init` nunca sai da rede Docker):
   ```nginx
   location ~ ^/api/mail-oauth/(google|microsoft)/callback$ {
       proxy_pass http://127.0.0.1:8881/$1/callback$is_args$args;
       proxy_set_header Host $host;
   }
   ```
   e `sudo nginx -t && sudo systemctl reload nginx`.
5. Subir o relay no lugar do antigo (mesma porta 8881):
   `docker rm -f shared-nylas-relay` e depois
   `docker compose -p tenants-shared -f docker-compose.shared.yml --env-file envs/shared.env up -d --build mail-oauth-relay`.
6. Levar as variáveis novas pros alunos já existentes e reiniciar:
   `scripts/sync-mail-oauth-env.sh --restart` (os novos já nascem com elas pelo template). O
   deploy normal do app aplica as migrações 0083 e 0084.
7. Reconectar a sua caixa em `https://estrategistacrm.crm.estrategistacrm.com.br/settings/email-sync`.

Sem os passos 1 e 2 o sistema funciona do mesmo jeito, mas só a opção IMAP/SMTP aparece (os botões
Gmail/Outlook ficam ocultos enquanto o client id estiver vazio).

**Limites honestos (todos gratuitos, mas vale saber)**

- **Google mostra "O Google não verificou este app"** pra quem conecta Gmail por OAuth, porque
  `gmail.modify` é um escopo restrito. O aluno clica em "Avançado → Acessar" e segue. Um app não
  verificado aceita até **100 usuários** no total. Tirar o aviso exige a verificação do Google,
  que para escopos restritos inclui uma avaliação de segurança paga (CASA). **Caminho sem aviso e
  sem limite:** Gmail pela opção "Outro provedor (IMAP/SMTP)" com uma **senha de app** (exige
  verificação em 2 etapas na conta Google). O preset "Gmail (senha de app)" já preenche tudo.
- **Microsoft** mostra "editor não verificado" na tela de consentimento, mas não bloqueia nem
  limita contas pessoais. Algumas empresas (Microsoft 365) exigem aprovação do administrador delas.
- Outlook/IMAP sincronizam por consulta periódica (~90s), olhando as mensagens dos últimos 14 dias
  (até 25 por pasta a cada rodada). Mover pra lixeira **dentro do CRM** reflete na caixa; apagar uma
  mensagem antiga direto no Outlook/webmail não é refletido no CRM.

**Checklist de teste manual** (depois das credenciais): conectar Gmail, Outlook e uma conta IMAP;
ver a primeira sincronização trazer e-mails; enviar um e-mail e uma resposta (conferir que cai na
mesma conversa e na pasta Enviados); mover uma conversa pra lixeira pelo CRM; baixar um anexo;
desconectar e reconectar.

## Moeda em reais (2026-09-26)

Todo valor monetário passa por um único formatador, `src/lib/formatCurrency.ts`
(`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`): `formatCurrency` para valores
arredondados (cartões do funil, totais, painel) e `formatCurrencyExact` com centavos (preços de
produtos, itens de negócio, faturas). Corrigido nesta rodada: preços de produtos e metas de valor
sem "R$", valor do lead, histórico de alterações ("1500.00"), o campo `{{deal.value}}` dos e-mails e
das automações (ia cru pro cliente) e o padrão `USD` da coluna `settings.base_currency` (migração
0085 troca pra BRL). O teste `src/lib/currencyGuard.test.ts` quebra se alguém formatar dinheiro fora
do helper ou reintroduzir `USD`/`en-US`.

## Interface 100% em português (2026-09-26)

A varredura foi sistemática: `src/test/uiTextScan.ts` usa o compilador do TypeScript pra extrair
todo texto visível do código (texto de JSX, `placeholder`/`aria-label`/`title`/`label`/`message`,
props padrão, arquivos de strings, mapas `*_LABEL`) e marca o que parece inglês. Achou 267
ocorrências; todas as reais foram traduzidas (filtros e seus operadores, primitivos compartilhados
como Select/Combobox, tela de consentimento OAuth, metas, menu "+", formulários de negócio e contato,
atividades e calendário, inbox e composer, leads, erros de importação, validações). Datas que seguiam
o idioma do navegador agora são sempre `pt-BR` ("há 3 dias", "ontem"). Os tipos de telefone/e-mail
continuam gravados como `Work`/`Mobile`... (dados existentes) e aparecem traduzidos na tela
(`src/constants/contactPointLabels.ts`).

`src/test/ptBrAudit.test.ts` quebra se aparecer texto novo em inglês na interface ou data sem
`pt-BR`. As exceções legítimas (chaves gravadas, nomes de fonte, endpoints de protocolo OAuth,
mensagens de boot pro operador) ficam listadas com o motivo no próprio teste.

## Ajuda "?" em cada funcionalidade (2026-09-26)

Um ícone "?" ao lado de páginas, seções e campos importantes abre uma explicação curta (clique,
toque ou Enter; funciona no celular). Componente: `src/components/ui/help-tooltip.tsx` (sobre o
Popover do shadcn). **Todos os textos ficam num só lugar:** `src/constants/helpTexts.ts`, com
chaves por área (`deal.value`, `pipeline.rotting`, `email.imap`...). Para mudar um texto, edite só
esse arquivo; para pôr um "?" novo, crie a chave lá e use `<HelpTooltip topic="..." />` (ou a prop
`help` de `PageHeading`, `SettingsHeading`, `SettingsCardHeader`, `Panel` do painel e
`CollapsibleSection` da barra lateral do negócio). O teste `src/test/helpCoverage.test.ts` exige
`help` em todo título de página.

## Automações mais completas e "Apps conectados" (2026-09-26)

Comparado com o Workflow Automation do Pipedrive
(https://support.pipedrive.com/en/article/workflow-automation), as automações ganharam:

- **Condições** ("Só executar se..."): várias condições ligadas por E, sobre valor, etapa,
  responsável, status, etiqueta, título e data prevista de fechamento do negócio. Regras antigas
  ficam sem condições e continuam funcionando igual.
- **Novos gatilhos:** atividade criada e atividade concluída em um negócio (pela tela ou pelo
  Claude via MCP).
- **Novas ações:** adicionar anotação ao negócio; chamar webhook (POST com os dados do negócio,
  bom para Zapier, Make ou n8n; endereços internos da VPS são bloqueados e redirecionamentos não
  são seguidos); notificar qualquer usuário (não só o responsável), com cópia por e-mail conforme
  as preferências dele; atualizar campo agora cobre título, valor, etapa, responsável e data
  prevista, com seletores em vez de texto livre.
- **Histórico de execuções** na tela de edição de cada automação, com o resultado de cada ação
  (por exemplo, "Enviar e-mail: erro (o responsável não tem caixa conectada)").
- Automações nunca disparam outras automações (atividade ou campo alterado por uma automação não
  dispara nada), para evitar laços.

Código em `src/features/automations/` (condições em `conditions.ts`, webhook em
`webhookRunner.ts`) e tela em `src/app/(app)/settings/automations/`. Migração
`drizzle/0086_automations_conditions.sql`.

**Apps conectados** (`/settings/connections`) deixou de ficar vazio: mostra o estado real da
caixa de e-mail (provedor, endereço, status, última sincronização), o endereço MCP para conectar
o Claude, os provedores de enriquecimento ativos e as automações que chamam webhooks (só o
domínio, pois a URL pode conter token), além da lista de apps autorizados com o botão revogar. Os
cartões de enriquecimento e webhooks só aparecem para quem pode administrá-los.

Ainda não existe em relação ao Pipedrive: atraso ("esperar N dias") dentro da automação,
gatilhos de pessoa/organização/lead, formulários web, Smart BCC e exportação CSV de negócios e
contatos.

## O que ainda não existe / próximos passos possíveis

- Script de **reativação** de tenant suspenso (hoje é manual, ver acima).
- Alerta se o disco desta VPS estiver enchendo (hoje só limpamos cache/imagens órfãs, não
  monitoramos o total).
- Teste de **restore** de backup nunca foi feito de verdade (só criação).
- Se algum dia quiser Google OAuth disponível *também* (hoje só magic-link): já dá suporte no
  código (`GOOGLE_OAUTH_CLIENT_ID/SECRET/GOOGLE_WORKSPACE_DOMAIN` em `envs/shared.env`), só falta
  criar um client OAuth no Google Cloud Console e cadastrar `https://<slug>.crm.estrategistacrm.com.br/auth/callback`
  manualmente pra cada aluno que quiser usar essa opção, o problema de escala original continua
  existindo pra esse método específico.
- **Gmail e Outlook por OAuth nunca foram testados com contas reais** (dependem das credenciais do
  passo a passo acima). Todo o resto foi testado contra Postgres real e, no caso do IMAP/SMTP,
  contra um servidor de e-mail real (GreenMail) nos testes automatizados.
- A tabela antiga `warpdrive_ops.nylas_connect_requests` pode ser apagada à mão quando quiser
  (`DROP TABLE nylas_connect_requests;` no banco `warpdrive_ops`); nada mais a usa.

## Onde ler mais

- `docs/deploy-multi-tenant.md`, passo a passo operacional completo (subir a stack do zero,
  adicionar/remover aluno, backup, migrar aluno pra VPS própria).
- `docs/superpowers/specs/2026-09-05-multi-tenant-provisioning-design.md`, a decisão de design
  original (por que um stack inteiro por aluno em vez de `tenant_id` nas tabelas).
- `CLAUDE.md`, convenções de código deste repo (TDD, Result types, etc.) caso mexa em `src/`.
