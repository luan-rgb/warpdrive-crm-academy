# Gmail/Outlook auto-connect via Nylas

## Context

Every CRM Academy tenant is provisioned with `GOOGLE_OAUTH_CLIENT_ID/SECRET/GOOGLE_WORKSPACE_DOMAIN`
empty (see `docs/deploy-multi-tenant.md`): login moved to magic-link because a single Google
OAuth client cannot register a `redirect_uri` per student subdomain. The exact same limitation
blocks the OTHER Google OAuth flow this app has: connecting a Gmail mailbox for two-way email
(`src/features/email/oauth.ts`, `redirect_uri: ${BASE_URL}/api/gmail/oauth/callback`). Worse,
`GOOGLE_WORKSPACE_DOMAIN` is one value shared by every tenant, so even if we registered redirect
URIs by hand per student, only Google accounts in *that one* Workspace domain could ever connect,
never an arbitrary student's own Gmail or company domain.

Goal (the user's words): "quero que tenha a mesma funcionalidade do Pipedrive, cada aluno conecta
com seu Gmail ou Outlook automaticamente" — self-service, no per-student admin step, no Outlook
support at all today (warpdrive only ever talked to Gmail's API directly).

## Decision

Adopt **Nylas v3** (hosted, unified email API) as the single mailbox-connect and mail-provider
layer for every tenant, replacing direct Gmail OAuth. One Nylas application (one API key, one
Client ID, already created: region `us`) serves every tenant, the same shape as the Resend key
already shared fleet-wide.

Why this resolves both problems at once:
- Nylas's hosted auth (`/v3/connect/auth`) uses **one fixed `redirect_uri`** regardless of which
  tenant or which end-user is connecting — never a per-subdomain URI, so nothing to register by
  hand ever again.
- One flow covers Gmail, Microsoft/Outlook, IMAP, and others via a `provider` query param, so
  Outlook support is "pass `provider=microsoft` instead of `google`", not a second integration.
- No workspace-domain restriction: any student connects any of their own accounts, on any domain.
- Nylas refreshes the underlying provider's OAuth token itself; we only ever hold a `grant_id`,
  never a Google/Microsoft refresh token, so `src/features/email/tokens.ts`'s whole
  refresh-skew/decrypt/re-encrypt mechanism becomes unnecessary for Nylas-connected accounts.

## What already fits, unmodified

`src/features/email/gmailClient.ts` exports a `GmailClient` interface (9 methods:
`historyList`, `getMessage`, `getThread`, `sendRaw`, `searchByRfc822`, `getAttachment`,
`listMessages`, `getProfile`, `trashThread`) that ~70 other files call through, never the raw
Gmail API directly (`gmailFake.ts` already exists as a test double, confirming this was built as
a swappable seam). A `createNylasClient(grantId): GmailClient` that implements the same interface
against Nylas's endpoints, translating Nylas's message/thread shape into the existing
`gmailMessageSchema`/`gmailThreadSchema` shapes, lets every one of those ~70 files (send,
threading, attachments, spam sweep, trash, tracking...) keep working completely unchanged. This
is the single biggest reason this migration is tractable instead of a full rewrite.

Confirmed live against the real connected account (`luan@estrategistacrm.com.br`, Gmail, via
`nylas email list --json`): Nylas already returns clean, decoded fields (`subject`, `from`, `to`,
`body` as ready HTML) rather than Gmail's raw base64 MIME envelope — actually *simpler* to map
from than Gmail's own payload, once the field-by-field translation is written and tested.

## What does NOT fit unmodified: sync

Gmail's `historyList`/`startHistoryId` is a **pull** model: a worker (`email.sync` pg-boss queue,
`src/features/email/sync.ts`) polls periodically, asking "what changed since this cursor". Nylas
v3 has no equivalent pull/delta endpoint (confirmed: no `history` or `delta` command anywhere in
`nylas email --help`) — it is a **push** model: a `message.created` webhook (confirmed via
`nylas webhook triggers`) fires when new mail arrives. `sync.ts`'s polling loop, `syncCursor.ts`,
and `last_history_id` do not carry over for Nylas-connected accounts; they're replaced by a
webhook receiver that feeds the same downstream pipeline (`applyMessages.ts`) a different way in.

This is the part of the migration that touches how mail actually arrives, not just how the
mailbox is connected, so it's the part most worth a careful look before committing to it (see
"Open questions" below) rather than assuming it away.

## Architecture

### 1. Connect flow (self-service, one click)

- Tenant UI: "Connect Gmail" / "Connect Outlook" button, unchanged in spirit from today's Google
  connect button, now pointing at a new route that redirects to
  `https://api.us.nylas.com/v3/connect/auth?client_id=<NYLAS_CLIENT_ID>&redirect_uri=<CENTRAL_URL>&response_type=code&provider=google|microsoft&state=<token>`.
- `state` is minted server-side by the tenant (not just a raw user id, per Nylas's own guidance)
  and recorded in a new small shared table (see below) alongside which tenant slug and which
  warpdrive `user_id` initiated the request, before redirecting.
- **`<CENTRAL_URL>` is one fixed address** (e.g. `https://crm.estrategistacrm.com.br/api/nylas/callback`),
  registered once in the Nylas dashboard. It is NOT any tenant's own subdomain, so it needs to run
  somewhere that isn't inside a single tenant's isolated container — see "Where the relay runs".
- The central callback exchanges `code` for a `grant_id` (`POST /v3/connect/token`), looks up
  `state` in the shared table to find which tenant + user this belongs to, and writes
  `email_accounts.nylas_grant_id` directly into **that tenant's own database** (all tenant
  databases live in the one shared Postgres instance, so this is a normal cross-database write
  with the shared admin credentials, the same access pattern `scripts/hotmart-lifecycle.sh`
  already uses).
- Redirects the browser back to that tenant's own `https://<slug>.crm.estrategistacrm.com.br/settings/email` when done.

### 2. New mail arriving (push, not poll)

- One Nylas webhook subscription, `message.created`, pointed at the same kind of central,
  fixed URL (Nylas webhooks are also app-wide, not per-tenant).
- Payload includes `grant_id` and the new message's id. The receiver looks up which tenant that
  grant belongs to (same shared mapping table as the connect flow, now doubling as a
  grant-to-tenant index), fetches the full message via the Nylas API (grant-scoped,
  authenticated with our one `NYLAS_API_KEY`), and either calls directly into that tenant's
  `applyMessages.ts` equivalent logic or enqueues a job for that tenant's own worker to pick up.
  (Exact mechanism — direct DB write from the relay vs. an authenticated internal API call into
  the tenant's own Next.js instance — is one of the open questions below.)
- Webhook signature verification (Nylas signs the payload with a webhook secret) gates this
  endpoint; `nylas webhook verify` exists to sanity-check this locally while building it.

### 3. Per-mailbox operations (fetch a thread, send, download an attachment)

- Unchanged call sites: `src/features/email/send.ts`, `sendSystem.ts`, `threadTrash.ts`,
  `attachmentDownload.ts`, etc., inside each tenant's own running app, call through the same
  `GmailClient` interface as always. Only the concrete implementation they receive changes, from
  `createGmailClient(accessToken)` to `createNylasClient({ apiKey, grantId })`.
- Send specifically needs a closer look before assuming parity: today's `sendSystem.ts` builds a
  raw RFC822 MIME blob (`mime.ts: buildMime` + `toRawBase64`) and calls `sendRaw`. Nylas's send
  API takes structured JSON (to/subject/body/attachments), not an arbitrary raw MIME blob, so the
  `nylasClient`'s `sendRaw` implementation either parses the MIME we built back into Nylas's
  structured shape (keeps `mime.ts` as-is, adapter absorbs the difference) or `send.ts`/`sendSystem.ts`
  get a small adjustment to build the structured payload directly instead of MIME. Needs the
  actual Nylas send payload shape confirmed against real docs/API before deciding, not assumed.

### 4. Data model changes

- `email_accounts.nylas_grant_id` (done, `drizzle/0082_warm_harrier.sql`, this session).
- New shared table (name TBD, e.g. `nylas_connect_requests`) in the shared Postgres instance,
  holding `state` (unique, single-use), `tenant_slug`, `user_id`, `provider`, `created_at`,
  `consumed_at`, `expires_at` — mirrors `magic_link_tokens`'s one-time-token shape closely enough
  to reuse the same patterns (hash the state if it's treated as sensitive, single-use enforced by
  an UPDATE ... WHERE consumed_at IS NULL ... RETURNING, same trick `verifyMagicLink` uses).
- A grant-id-to-tenant index is needed for the incoming webhook to route by (not by the transient
  `state`, which is gone by then) — could be the same table if it also gets a `grant_id` column
  filled in once the connect flow completes, or a separate persistent table. Needs to be
  reconciled with per-tenant deprovisioning (`deprovision-tenant.sh`): a deleted tenant's rows
  here must be cleaned up too, or a stale grant_id could route webhook traffic nowhere useful.
- `refresh_token_enc`, `tokens.ts`'s refresh mechanism, and Gmail-direct `oauth.ts`/`linking.ts`
  are retired in practice (no code deletion forced immediately, but nothing new is written
  through them once this ships; direct Gmail OAuth is pre-launch with zero real accounts using it
  today, so there is no live-migration concern).

## Where the relay/webhook receiver runs

Not decided yet — needs your input. Candidates:
- A small standalone Node/bash service on the host (same shape as `scripts/hotmart-lifecycle.sh`,
  but as a long-running HTTP listener behind nginx, not a cron), independent of any tenant's own
  container. Simplest mental model, matches the Hotmart precedent, but is new infra to run/watch.
- A route inside ONE designated tenant's app (e.g. a special "hub" concept) — avoids a new
  service, but there is no natural "hub tenant" today (every tenant is meant to be equally a
  full, independent warpdrive instance), and it would need care not to conflate this hub role
  with being anyone's actual CRM account.

Leaning toward the first (standalone service) for the same reason the Hotmart lifecycle script
is standalone: it needs cross-tenant-database access the shared admin credentials already grant,
and keeping it outside any one tenant's container keeps the tenant containers' blast radius
exactly what it already is (their own database only, via their own scoped role).

## Rollout

1. **Gmail first.** Validate the whole chain (connect, `message.created` webhook, on-demand
   fetch/send via the adapter) against the one real, already-connected account
   (`luan@estrategistacrm.com.br`, grant `b41bafcd-...`) before touching anything tenant-facing.
2. **Outlook next**, expected close to free once Gmail is proven: same client, same webhook
   shape, `provider=microsoft` in the connect URL is the only difference Nylas exposes to us.
3. Each piece ships with tests first per `CLAUDE.md` (a `nylasFake.ts` test double mirroring
   `gmailFake.ts`'s existing shape; the connect-relay and webhook receiver get their own
   integration tests against the real shared Postgres, same convention as everything else in
   this repo).

## Open questions (need your call before implementation continues)

1. **Where does the relay run** — standalone host service, or a route on a designated tenant? (a
   recommendation is above; confirm or override)
2. **Relay-to-tenant delivery mechanism** for a new message: does the central relay write
   directly into the tenant's database (same cross-database admin-credential pattern as
   `hotmart-lifecycle.sh`), or call an authenticated internal API on that tenant's own running
   app? Direct DB write is simpler and consistent with existing precedent; an API call keeps all
   business logic (visibility rules, notifications, mail-label resolution) inside the tenant's
   own app instead of duplicating it in the relay.
3. **Send payload shape**: confirm Nylas's actual send API accepts (or doesn't) a raw MIME
   attachment, to decide whether `mime.ts`/`send.ts` need any change at all.
4. **Nylas pricing at ~6-50 tenants**: worth a quick look at the dashboard's plan/usage limits
   before every student connects a live mailbox, so this doesn't surprise anyone later.
5. Existing Gmail-direct code (`oauth.ts`, `linking.ts`, `tokens.ts`, the `email.sync` pg-boss
   queue): leave in place unused, or remove once Nylas is proven? No real accounts use it today,
   so there's no data migration either way, only a decision about dead-code cleanup timing.
