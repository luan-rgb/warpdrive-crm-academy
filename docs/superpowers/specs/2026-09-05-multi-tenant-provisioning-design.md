# Multi-Tenant Provisioning for CRM Academy Students

## Context

warpdrive is designed single-tenant: no `tenant_id` anywhere in the 46-table
schema, `users.email` is globally unique, permissions/teams/visibility groups
assume one company. The CRM Academy course needs up to ~50 students sharing
one VPS, each with their own isolated CRM, until revenue funds a dedicated
VPS per cohort.

Retrofitting real multi-tenancy (tenant_id on every table + RLS policies +
tenant-aware tRPC/WS/pg-boss context) was considered and rejected: it touches
every table and query in an app that was never designed for it, and a single
missed filter is a cross-student data leak. Given the deploy is already a
clean single-box docker-compose stack (app + ws + worker + postgres + minio
behind Caddy), the chosen approach reuses that design unmodified per student,
instead of building tenancy into the application.

## Decision

**One full stack per student, sharing physical Postgres and MinIO.**

- Postgres and MinIO run once, shared across all students, each on the
  existing internal Docker network.
- Each student gets: one Postgres database + one Postgres role scoped to
  `GRANT CONNECT` on that database only, one MinIO bucket + one access key
  scoped to that bucket only.
- Each student gets their own `app` + `ws` + `worker` + `migrate` containers
  (unmodified warpdrive image), run as a separate Compose project
  (`docker compose -p aluno-<slug>`), pointed at their database/bucket via a
  per-student `.env`.
- Caddy gets one site block per student (`aluno-<slug>.{$APP_DOMAIN}`),
  reverse-proxying to that student's `app`/`ws` containers by Compose-assigned
  DNS name on the shared network.

**Zero changes to warpdrive application source.** All new files are
deployment/ops tooling, not `src/`.

## Isolation guarantee

Isolation is enforced by Postgres role permissions and MinIO bucket policy,
not by application code:

- A student's Postgres role has no grant on any other student's database.
  `\c otherstudent_db` as that role fails with permission denied regardless
  of what the app does.
- A student's MinIO access key's policy allows only their bucket. Any S3 call
  against another bucket returns AccessDenied.

This is stronger than RLS for this use case: it cannot be defeated by a query
in the app forgetting a `WHERE tenant_id = ...` filter, because the
credential itself cannot see the other student's data at the protocol level.

## Components

### 1. `docker-compose.shared.yml`

Extracts `postgres` and `minio` (+ `createbuckets` becomes per-tenant, see
below) out of the existing `docker-compose.yml` into a stack that runs once,
attached to an external network `tenants-net`. Uses the same images/config
as today; only the network and lifecycle change (this stack is long-lived
and provisioned once, not per student).

### 2. `docker-compose.tenant.yml` (override)

Applied on top of the existing `docker-compose.yml` when starting a student
stack:

- Removes `postgres`, `minio`, `createbuckets` service definitions (student
  stack does not own these).
- Adds `external: true` network reference to `tenants-net` for `app`, `ws`,
  `worker`, `migrate`.
- No image or command changes: `app`/`ws`/`worker`/`migrate` run exactly as
  they do today, just against a per-student `.env`.

### 3. `scripts/provision-tenant.sh <slug>`

Idempotent, run once per new student:

1. Generate a Postgres database + role named `aluno_<slug>` with a random
   password; `GRANT CONNECT ON DATABASE aluno_<slug> TO aluno_<slug>` and
   revoke connect from `PUBLIC` on that database.
2. Create a MinIO bucket `aluno-<slug>` and an access key scoped to it via a
   MinIO bucket policy (deny-by-default, allow only this bucket's ARN).
3. Generate the student's secrets: `WS_TICKET_SECRET`, `TOKEN_ENCRYPTION_KEY`
   (32 bytes base64), `OAUTH_SIGNING_KEY`, matching the existing `env.ts`
   validation rules.
4. Write `envs/aluno-<slug>.env` from a template, substituting: database
   name/role/password, bucket name/keys, `APP_DOMAIN=aluno-<slug>.{base
   domain}`, `BASE_URL`, `NEXT_PUBLIC_WS_URL`, `MINIO_ENDPOINT`.
5. Run migrations and bring the stack up:
   `docker compose -p aluno-<slug> -f docker-compose.yml -f docker-compose.tenant.yml --env-file envs/aluno-<slug>.env up -d`.
6. Append a Caddy site block for `aluno-<slug>.{$APP_DOMAIN}` reverse-proxying
   to `aluno-<slug>-app-1:3000` and `aluno-<slug>-ws-1:8080` on `tenants-net`,
   then `docker exec caddy caddy reload`.

### 4. `scripts/deprovision-tenant.sh <slug>`

Reverse of provisioning, for a cancelled student: stop and remove the
student's Compose project, drop the Caddy block and reload, drop the
Postgres database/role, delete the MinIO bucket/access key. Requires
explicit confirmation (destructive, deletes the student's data) since this
is data deletion, not just stopping a process.

### 5. `scripts/verify-tenant-isolation.sh`

Provisions two throwaway test tenants (`_isotest_a`, `_isotest_b`), then
asserts:

- Connecting to Postgres as tenant A's role and running `\c aluno__isotest_b`
  fails with a permission error.
- Calling the S3 API with tenant A's MinIO access key against tenant B's
  bucket returns `AccessDenied`.
- Both assertions are printed as PASS/FAIL; script exits non-zero on any
  FAIL. Deprovisions both test tenants on exit (success or failure).

This is the one runnable check for this work: it fails loudly if a future
change to the provisioning script (e.g. someone "simplifies" the GRANT step)
reopens the isolation gap.

## Out of scope

- Billing/signup automation (student payment triggering
  `provision-tenant.sh` automatically) — provisioning is a manual admin
  action for now, matching current course scale (~50 students).
- Migrating existing single-tenant data to student databases — this feature
  is for new students going forward, not backfilling anyone.
- Wildcard TLS / dynamic Caddy config generation — explicit site blocks per
  student are fine at this scale; revisit if this grows past what hand-off
  reload can manage smoothly.
- Moving off shared Postgres/MinIO to per-student VPS — that is the
  documented future step once course revenue funds it, not part of this
  design.

## Testing

No `src/` changes means no Vitest unit/integration tests apply. Verification
is the `verify-tenant-isolation.sh` script above (bash + `psql` + `mc`/`curl`
against the real shared Postgres/MinIO, following this project's rule of
testing against real infra rather than mocks).
