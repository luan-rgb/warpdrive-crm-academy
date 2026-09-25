# CRM Academy no warpdrive — doc-mestre

Documento de estado, não de arquitetura de referência (isso é `docs/deploy-multi-tenant.md` e
`docs/superpowers/specs/2026-09-05-multi-tenant-provisioning-design.md`, ambos ainda válidos).
Este arquivo existe pra alguém (você, ou uma sessão futura do Claude) entender rápido **o que
existe hoje, por que, e onde mexer** sem precisar reconstruir o histórico de decisões. Atualize-o
sempre que algo aqui descrito mudar de verdade.

Última atualização: 2026-09-25.

## O que é isto

`warpdrive-crm-academy` (fork de `sneg55/warpdrive`) hospedado em modo **multi-tenant** nesta VPS
(`179.197.74.109`): cada aluno da CRM Academy recebe um CRM warpdrive isolado (banco, bucket,
containers próprios) em `<slug>.crm.estrategistacrm.com.br`, provisionado **automaticamente**
quando uma compra na Hotmart completa 7 dias (fim da garantia).

Você também tem uma conta pessoal provisionada do mesmo jeito: **estrategistacrm** →
`https://estrategistacrm.crm.estrategistacrm.com.br` (login: `luan@estrategistacrm.com.br` via
magic-link). Não é um aluno, é o seu uso próprio pra vender os produtos da Estrategista — mesmo
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
| `envs/shared.env` | `~/warpdrive/envs/shared.env` | Segredos da stack: senhas do Postgres/MinIO, `RESEND_API_KEY`, `MAGIC_LINK_FROM_EMAIL`. `GOOGLE_OAUTH_*` ficam vazias de propósito (login é por magic-link) |
| Roteamento por subdomínio | `~/warpdrive/caddy/Caddyfile.tenants` | Um bloco por aluno, entre marcadores `BEGIN/END TENANT`. **Nunca edite à mão** — só via provision/deprovision |
| TLS | nginx do host (`/etc/nginx/sites-available/warpdrive-tenants`) | Termina TLS com o wildcard `*.crm.estrategistacrm.com.br` (acme.sh/DNS-01) e repassa pro Caddy interno |
| Provisionar aluno | `scripts/provision-tenant.sh <slug> <email>` | Banco + bucket + containers + bloco Caddy |
| Remover aluno (destrutivo) | `scripts/deprovision-tenant.sh <slug> --yes-delete-data` | Some com tudo. Só rode se tiver certeza |
| Suspender (não-destrutivo) | `docker compose -p aluno-<slug> -f docker-compose.tenant.yml --env-file envs/aluno-<slug>.env stop` | O que o cron faz sozinho; dá pra rodar à mão também |
| Ciclo de vida Hotmart | `scripts/hotmart-lifecycle.sh` | Cron diário (04:00), ver acima |
| Backup | `scripts/backup-tenants.sh` | Cron diário (03:17): `pg_dumpall` + volume MinIO + `envs/` + limpeza de imagens/cache órfãos, retenção 7 dias, em `/opt/backups/warpdrive-tenants/` |
| Login por e-mail | `src/features/auth/magicLink.ts` + `magicLinkEmail.ts` | Reaproveita o Resend já configurado; alternativa ao Google OAuth (que não escala por subdomínio) |
| Registro de compras/tenants | Tabela `crm_compras` no Postgres principal do Supabase (`supabase-db`) | **Não é um banco novo** — reaproveita a tabela que `crm-hotmart` já escrevia, com colunas novas `warpdrive_*` |

## Perguntas que você provavelmente vai ter

**"Um aluno some da lista, o que faço?"** Veja `crm_compras.warpdrive_status`
(`pendente`/`provisionado`/`suspenso`) e `status` (`aprovada`/`cancelada`/`reembolsada`) via
`docker exec supabase-db psql -U postgres -d postgres -c "SELECT * FROM crm_compras WHERE comprador_email = '...'"`.

**"Quero reativar um aluno suspenso (reembolso revertido, ano renovado etc)."** Não existe script
pronto pra isso ainda — hoje é manual: `docker compose -p aluno-<slug> ... up -d` pra religar os
containers, e atualizar `warpdrive_status`/`warpdrive_expires_at` na mesma linha de `crm_compras`.
Se isso virar rotina, vale um `scripts/reactivate-tenant.sh`.

**"Quero mudar quanto tempo depois do vencimento ele é suspenso, ou o aviso de 30 dias."** Edite
as constantes no topo de `scripts/hotmart-lifecycle.sh` (`interval '30 days'` etc.) e o `+365 days`
na seção de entrega.

**"O cron roda de quanto em quanto tempo? Por que um aluno não apareceu na hora?"** Uma vez por
dia, 04:00. Alguém que completa os 7 dias às 04:01 só é liberado ~24h depois. Se quiser mais
precisão, troque `0 4 * * *` por `0 * * * *` no crontab (`crontab -e`) pra rodar de hora em hora —
o script é idempotente, não tem problema rodar mais vezes.

**"Quantos alunos cabem nesta VPS?"** Medido em 2026-09-21: **~6-8 tenants simultâneos**, 2 vCPU e
~7.8GB de RAM já divididos com seus outros produtos (Supabase, Chatwoot, AFFiNE, Excalidraw...).
Não bloqueia começar, bloqueia crescer — se a turma passar disso, ou aumenta a RAM desta VPS, ou
migra algum produto pra outro lugar antes de continuar vendendo.

**"Onde estão os segredos?"** `envs/shared.env` (permissão 600, fora do git). O `RESEND_API_KEY`
foi reaproveitado da conta que já existia pro Twenty CRM (mesmo domínio verificado
`estrategistacrm.com.br`) — se aquela conta Resend for encerrada um dia, isso quebra o envio de
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
3. **Log do `hotmart-lifecycle.sh` duplicava cada linha.** O script já redireciona sua própria
   saída pra um `tee`; o crontab redirecionava de novo por fora. Corrigido removendo o
   redirecionamento externo no crontab (o script já cuida disso sozinho).

## O que ainda não existe / próximos passos possíveis

- Script de **reativação** de tenant suspenso (hoje é manual, ver acima).
- Alerta se o disco desta VPS estiver enchendo (hoje só limpamos cache/imagens órfãs, não
  monitoramos o total).
- Teste de **restore** de backup nunca foi feito de verdade (só criação).
- Se algum dia quiser Google OAuth disponível *também* (hoje só magic-link): já dá suporte no
  código (`GOOGLE_OAUTH_CLIENT_ID/SECRET/GOOGLE_WORKSPACE_DOMAIN` em `envs/shared.env`), só falta
  criar um client OAuth no Google Cloud Console e cadastrar `https://<slug>.crm.estrategistacrm.com.br/auth/callback`
  manualmente pra cada aluno que quiser usar essa opção — o problema de escala original continua
  existindo pra esse método específico.

## Onde ler mais

- `docs/deploy-multi-tenant.md` — passo a passo operacional completo (subir a stack do zero,
  adicionar/remover aluno, backup, migrar aluno pra VPS própria).
- `docs/superpowers/specs/2026-09-05-multi-tenant-provisioning-design.md` — a decisão de design
  original (por que um stack inteiro por aluno em vez de `tenant_id` nas tabelas).
- `CLAUDE.md` — convenções de código deste repo (TDD, Result types, etc.) caso mexa em `src/`.
