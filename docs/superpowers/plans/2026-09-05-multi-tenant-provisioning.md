# Multi-Tenant Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let up to ~50 CRM Academy students each run their own isolated warpdrive instance on one shared VPS, with isolation enforced by Postgres role grants and MinIO bucket policy rather than any change to the application.

**Architecture:** A shared, long-lived stack (Postgres, MinIO, Caddy) runs once. Each student gets their own `app`/`ws`/`worker`/`migrate` containers (unmodified warpdrive image, built with that student's `NEXT_PUBLIC_WS_URL` baked in), their own Postgres database + role, and their own MinIO bucket + access key. `scripts/provision-tenant.sh` and `scripts/deprovision-tenant.sh` create and tear these down; `scripts/verify-tenant-isolation.sh` is the automated proof that isolation holds.

**Tech Stack:** Docker Compose v2, Postgres 16, MinIO (`mc` admin CLI), Caddy 2, bash.

**Spec:** `docs/superpowers/specs/2026-09-05-multi-tenant-provisioning-design.md`

## Global Constraints

- Zero changes to `src/` or any warpdrive application code. Every new file is deployment/ops tooling.
- Isolation must hold at the infrastructure layer (Postgres `GRANT CONNECT`, MinIO bucket policy), never rely on an application query filtering correctly.
- No secrets committed to git: `envs/*.env` (rendered, real secrets) is gitignored; only `*.env.example` / `*.env.template` (placeholders) are committed.
- Provisioning is a manual admin action (no billing/signup automation) at this scale.
- "Test" for every task in this plan means running the actual script/command against the real Docker stack and reading its real output, per this project's existing rule of never mocking infrastructure. There is no Vitest suite for this work.
- Slugs are lowercase letters, digits, hyphens only, and become: the subdomain (`<slug>.$BASE_DOMAIN`), the Compose project name (`aluno-<slug>`), the Postgres db/role (`aluno_<slug with `-`→`_`>`), and the MinIO bucket (`aluno-<slug>`).

---

### Task 1: Shared stack (Postgres + MinIO + Caddy)

**Files:**
- Create: `docker-compose.shared.yml`
- Create: `Caddyfile.tenants`
- Create: `envs/shared.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: a Docker network named `tenants-net` (external, referenced by later tasks), containers named `shared-postgres`, `shared-minio`, `shared-caddy`, all reachable by other Compose projects attached to `tenants-net`.
- Produces: `envs/shared.env` (gitignored, created locally by the operator from the example) supplying `SHARED_POSTGRES_ADMIN_USER`, `SHARED_POSTGRES_ADMIN_PASSWORD`, `SHARED_MINIO_ROOT_USER`, `SHARED_MINIO_ROOT_PASSWORD`, `BASE_DOMAIN`, `ACME_EMAIL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_WORKSPACE_DOMAIN`, consumed by every later task's scripts.

- [ ] **Step 1: Create `docker-compose.shared.yml`**

```yaml
# One-time shared services for multi-tenant hosting: a single Postgres instance holding one
# database per student, a single MinIO instance holding one bucket per student, and the single
# public Caddy listener that fronts every student's subdomain plus the shared s3 subdomain.
# Bring up once per box, before provisioning any tenant. See docs/deploy-multi-tenant.md.
networks:
  tenants-net:
    name: tenants-net

services:
  postgres:
    image: postgres:16-alpine
    container_name: shared-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${SHARED_POSTGRES_ADMIN_USER:?set SHARED_POSTGRES_ADMIN_USER}
      POSTGRES_PASSWORD: ${SHARED_POSTGRES_ADMIN_PASSWORD:?set SHARED_POSTGRES_ADMIN_PASSWORD}
      POSTGRES_DB: postgres
    volumes: [shared_pgdata:/var/lib/postgresql/data]
    networks: [tenants-net]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${SHARED_POSTGRES_ADMIN_USER:?set SHARED_POSTGRES_ADMIN_USER}"]
      interval: 5s
      timeout: 5s
      retries: 10

  minio:
    image: minio/minio
    container_name: shared-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${SHARED_MINIO_ROOT_USER:?set SHARED_MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${SHARED_MINIO_ROOT_PASSWORD:?set SHARED_MINIO_ROOT_PASSWORD}
    volumes: [shared_miniodata:/data]
    networks: [tenants-net]

  caddy:
    image: caddy:2-alpine
    container_name: shared-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      BASE_DOMAIN: ${BASE_DOMAIN:?set BASE_DOMAIN}
      ACME_EMAIL: ${ACME_EMAIL:?set ACME_EMAIL}
    volumes:
      - ./Caddyfile.tenants:/etc/caddy/Caddyfile
      - shared_caddydata:/data
      - shared_caddyconfig:/config
    networks: [tenants-net]
    depends_on:
      minio:
        condition: service_started

volumes:
  shared_pgdata:
  shared_miniodata:
  shared_caddydata:
  shared_caddyconfig:
```

- [ ] **Step 2: Create `Caddyfile.tenants`**

```
# Shared Caddy config for multi-tenant CRM Academy hosting. The s3 block below is static: one
# shared MinIO fronts every tenant's bucket, selected by bucket name in the request path, not by
# hostname, so it needs no per-tenant block. Per-tenant site blocks are appended below by
# scripts/provision-tenant.sh between BEGIN/END TENANT markers, and removed by
# scripts/deprovision-tenant.sh using the same markers. Do not hand-edit a generated block; edit
# anything above the first marker freely. See docs/deploy-multi-tenant.md.

s3.{$BASE_DOMAIN} {
	tls {$ACME_EMAIL}

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Content-Security-Policy "sandbox; default-src 'none'; frame-ancestors 'none'"
		-Server
	}

	reverse_proxy shared-minio:9000
}
```

- [ ] **Step 3: Create `envs/shared.env.example`**

```sh
# Copy to envs/shared.env and fill in. envs/shared.env is gitignored: it holds real secrets.
SHARED_POSTGRES_ADMIN_USER=tenant_admin
SHARED_POSTGRES_ADMIN_PASSWORD=changeme-generate-with-openssl-rand-hex-24
SHARED_MINIO_ROOT_USER=tenant_admin
SHARED_MINIO_ROOT_PASSWORD=changeme-generate-with-openssl-rand-hex-24
# Wildcard DNS: *.{BASE_DOMAIN} and s3.{BASE_DOMAIN} must both point at this box's public IP
# before provisioning the first tenant, so Caddy's automatic TLS can complete the ACME challenge
# for each new subdomain without a manual DNS step per student.
BASE_DOMAIN=alunos.example.com
ACME_EMAIL=you@example.com
# One Google Cloud OAuth client shared by every tenant. Each new tenant subdomain's redirect URIs
# (https://<slug>.{BASE_DOMAIN}/api/gmail/oauth/callback and the sign-in callback) must be added
# to this client in the Google Cloud Console by hand; see docs/deploy-multi-tenant.md.
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_WORKSPACE_DOMAIN=
```

- [ ] **Step 4: Update `.gitignore`**

Add, near the existing `.env` block:

```
envs/*.env
!envs/*.env.example
!envs/*.env.template
```

- [ ] **Step 5: Create a local `envs/shared.env` for testing**

```sh
mkdir -p envs
cp envs/shared.env.example envs/shared.env
```

Edit `envs/shared.env`: set `SHARED_POSTGRES_ADMIN_PASSWORD` and `SHARED_MINIO_ROOT_PASSWORD` to `openssl rand -hex 24` output each, `BASE_DOMAIN=localtest.dev` (no real DNS needed for this step), `ACME_EMAIL=test@localtest.dev`. `GOOGLE_OAUTH_*` can stay empty for this task; they are only consumed by tenant stacks, not the shared one.

- [ ] **Step 6: Bring the shared stack up and verify it**

Run: `docker compose -p tenants-shared -f docker-compose.shared.yml --env-file envs/shared.env up -d`
Expected: three containers created (`shared-postgres`, `shared-minio`, `shared-caddy`).

Run: `docker compose -p tenants-shared -f docker-compose.shared.yml ps`
Expected: all three show `running` (Caddy may briefly retry the s3 TLS cert since `s3.localtest.dev` is not real DNS; that is expected and does not affect this task, only real cert issuance in production).

Run: `docker compose -p tenants-shared -f docker-compose.shared.yml exec postgres pg_isready -U tenant_admin`
Expected: `accepting connections`

Run: `docker network inspect tenants-net --format '{{.Name}}'`
Expected: `tenants-net`

- [ ] **Step 7: Commit**

```bash
git add docker-compose.shared.yml Caddyfile.tenants envs/shared.env.example .gitignore
git commit -m "feat: add shared Postgres/MinIO/Caddy stack for multi-tenant hosting"
```

---

### Task 2: Per-tenant stack definition

**Files:**
- Create: `docker-compose.tenant.yml`
- Create: `envs/tenant.env.template`

**Interfaces:**
- Consumes: `tenants-net` network from Task 1 (must already exist).
- Produces: a Compose file that, given a rendered tenant env file, starts `app`/`ws`/`worker`/`migrate` containers named `aluno-<slug>-<service>-1` (Compose's default naming for project `aluno-<slug>`), which Task 3's Caddy block generation and Task 5's isolation checks both reference by that exact name.

- [ ] **Step 1: Create `docker-compose.tenant.yml`**

```yaml
# Per-student stack: app + ws + worker + migrate, sharing the tenants-net Postgres/MinIO from
# docker-compose.shared.yml. Brought up once per student by scripts/provision-tenant.sh as its
# own Compose project (docker compose -p aluno-<slug>), so container names never collide between
# students. Each service is built (not a shared prebuilt image) because NEXT_PUBLIC_WS_URL is
# inlined into the Next.js client bundle at build time and differs per student's subdomain.
# See docs/deploy-multi-tenant.md.
x-app-build: &app-build
  context: .
  args:
    NEXT_PUBLIC_WS_URL: ${NEXT_PUBLIC_WS_URL:?set NEXT_PUBLIC_WS_URL for this tenant}
    APP_VERSION: ${APP_VERSION:-}

x-tenant-env: &tenant-env
  NODE_ENV: production
  GOOGLE_OAUTH_CLIENT_ID: ${GOOGLE_OAUTH_CLIENT_ID:?set GOOGLE_OAUTH_CLIENT_ID}
  GOOGLE_OAUTH_CLIENT_SECRET: ${GOOGLE_OAUTH_CLIENT_SECRET:?set GOOGLE_OAUTH_CLIENT_SECRET}
  GOOGLE_WORKSPACE_DOMAIN: ${GOOGLE_WORKSPACE_DOMAIN:?set GOOGLE_WORKSPACE_DOMAIN}
  BASE_URL: ${BASE_URL:?set BASE_URL}
  DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL}
  WS_TICKET_SECRET: ${WS_TICKET_SECRET:?set WS_TICKET_SECRET}
  WS_PUBLIC_URL: ${WS_PUBLIC_URL:?set WS_PUBLIC_URL}
  MINIO_ENDPOINT: ${MINIO_ENDPOINT:?set MINIO_ENDPOINT}
  MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY:?set MINIO_ACCESS_KEY}
  MINIO_SECRET_KEY: ${MINIO_SECRET_KEY:?set MINIO_SECRET_KEY}
  MINIO_BUCKET: ${MINIO_BUCKET:?set MINIO_BUCKET}
  TOKEN_ENCRYPTION_KEY: ${TOKEN_ENCRYPTION_KEY:?set TOKEN_ENCRYPTION_KEY}
  OAUTH_SIGNING_KEY: ${OAUTH_SIGNING_KEY:?set OAUTH_SIGNING_KEY}
  SEED_ADMIN_EMAIL: ${SEED_ADMIN_EMAIL:?set SEED_ADMIN_EMAIL}
  ALLOW_FIRST_LOGIN_ADMIN: "false"

networks:
  default:
    name: tenants-net
    external: true

services:
  migrate:
    build: *app-build
    command: ["node", "dist/migrate.mjs"]
    environment: *tenant-env

  app:
    build: *app-build
    restart: unless-stopped
    command: ["node_modules/.bin/next", "start"]
    environment: *tenant-env
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://localhost:3000/api/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 20s
    depends_on:
      migrate:
        condition: service_completed_successfully

  ws:
    build: *app-build
    restart: unless-stopped
    command: ["node", "dist/ws.mjs"]
    environment: *tenant-env
    healthcheck:
      test:
        - "CMD"
        - "node"
        - "-e"
        - "require('node:net').connect(8080,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 10s
    depends_on:
      migrate:
        condition: service_completed_successfully

  worker:
    build: *app-build
    restart: unless-stopped
    command: ["node", "dist/worker.mjs"]
    environment: *tenant-env
    depends_on:
      migrate:
        condition: service_completed_successfully
```

- [ ] **Step 2: Create `envs/tenant.env.template`**

```sh
# Rendered per-tenant by scripts/provision-tenant.sh into envs/aluno-<slug>.env. The __TOKENS__
# below are substituted; nothing here is a real secret.
NEXT_PUBLIC_WS_URL=wss://__SLUG__.__BASE_DOMAIN__/_ws
APP_VERSION=

GOOGLE_OAUTH_CLIENT_ID=__GOOGLE_OAUTH_CLIENT_ID__
GOOGLE_OAUTH_CLIENT_SECRET=__GOOGLE_OAUTH_CLIENT_SECRET__
GOOGLE_WORKSPACE_DOMAIN=__GOOGLE_WORKSPACE_DOMAIN__
BASE_URL=https://__SLUG__.__BASE_DOMAIN__
DATABASE_URL=postgres://__DB_ROLE__:__DB_PASSWORD__@shared-postgres:5432/__DB_NAME__
WS_TICKET_SECRET=__WS_TICKET_SECRET__
WS_PUBLIC_URL=ws://ws:8080
MINIO_ENDPOINT=https://s3.__BASE_DOMAIN__
MINIO_ACCESS_KEY=__MINIO_ACCESS_KEY__
MINIO_SECRET_KEY=__MINIO_SECRET_KEY__
MINIO_BUCKET=__MINIO_BUCKET__
TOKEN_ENCRYPTION_KEY=__TOKEN_ENCRYPTION_KEY__
OAUTH_SIGNING_KEY=__OAUTH_SIGNING_KEY__
SEED_ADMIN_EMAIL=__SEED_ADMIN_EMAIL__
```

- [ ] **Step 3: Verify the compose file parses**

Run: `docker compose -f docker-compose.tenant.yml --env-file envs/tenant.env.template config >/dev/null && echo OK`
Expected: `OK` (the template's placeholder text satisfies every `:?required` interpolation, proving no var is missing; this does not start any container).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.tenant.yml envs/tenant.env.template
git commit -m "feat: add per-tenant app/ws/worker/migrate compose definition"
```

---

### Task 3: `scripts/provision-tenant.sh`

**Files:**
- Create: `scripts/provision-tenant.sh`

**Interfaces:**
- Consumes: `envs/shared.env` (Task 1), `docker-compose.tenant.yml` + `envs/tenant.env.template` (Task 2), `Caddyfile.tenants` (Task 1).
- Produces: `envs/aluno-<slug>.env`, a running `aluno-<slug>` Compose project, a Postgres database `aluno_<slug_>` + role of the same name, a MinIO bucket `aluno-<slug>` + access key `aluno-<slug>`, an appended Caddy block. Later tasks (deprovision, verify) call this script directly rather than re-implementing any of these steps.
- CLI: `scripts/provision-tenant.sh <slug> <seed-admin-email> [--skip-app]`. `--skip-app` creates the database/bucket/env file only, used by Task 5's isolation check for speed.

- [ ] **Step 1: Create `scripts/provision-tenant.sh`**

```bash
#!/usr/bin/env bash
# Provisions one student's isolated warpdrive stack: a Postgres database + role scoped to it
# only, a MinIO bucket + access key scoped to it only, a rendered .env, the app/ws/worker
# containers, and a Caddy site block. See docs/deploy-multi-tenant.md.
#
# Usage: scripts/provision-tenant.sh <slug> <seed-admin-email> [--skip-app]
#   <slug>              lowercase letters, digits, hyphens only.
#   <seed-admin-email>  the student's Google account, bootstrapped as their CRM admin.
#   --skip-app          create the database/bucket/env file only; skip containers and Caddy.
#                        Used by verify-tenant-isolation.sh for a fast check.
set -euo pipefail

SLUG="${1:?usage: provision-tenant.sh <slug> <seed-admin-email> [--skip-app]}"
SEED_ADMIN_EMAIL="${2:?usage: provision-tenant.sh <slug> <seed-admin-email> [--skip-app]}"
SKIP_APP=false
[[ "${3:-}" == "--skip-app" ]] && SKIP_APP=true

if [[ ! "$SLUG" =~ ^[a-z0-9-]+$ ]]; then
  echo "error: slug must be lowercase letters, digits, hyphens only (got: $SLUG)" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=/dev/null
source envs/shared.env

if ! docker compose -p tenants-shared -f docker-compose.shared.yml ps postgres --format '{{.State}}' 2>/dev/null | grep -q running; then
  echo "error: shared stack is not running. Bring it up first:" >&2
  echo "  docker compose -p tenants-shared -f docker-compose.shared.yml --env-file envs/shared.env up -d" >&2
  exit 1
fi

DB_NAME="aluno_${SLUG//-/_}"
DB_ROLE="$DB_NAME"
DB_PASSWORD="$(openssl rand -hex 24)"
BUCKET="aluno-${SLUG}"
MINIO_ACCESS_KEY="aluno-${SLUG}"
MINIO_SECRET_KEY="$(openssl rand -hex 24)"
WS_TICKET_SECRET="$(openssl rand -hex 32)"
TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
OAUTH_SIGNING_KEY="$(openssl rand -hex 32)"
ENV_FILE="envs/aluno-${SLUG}.env"

if [[ -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE already exists, refusing to overwrite an existing tenant" >&2
  exit 1
fi

echo "== creating Postgres database and role for $SLUG =="
docker compose -p tenants-shared -f docker-compose.shared.yml exec -T postgres \
  psql -U "$SHARED_POSTGRES_ADMIN_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE "${DB_ROLE}" WITH LOGIN PASSWORD '${DB_PASSWORD}';
CREATE DATABASE "${DB_NAME}" OWNER "${DB_ROLE}";
REVOKE CONNECT ON DATABASE "${DB_NAME}" FROM PUBLIC;
GRANT CONNECT ON DATABASE "${DB_NAME}" TO "${DB_ROLE}";
SQL

echo "== creating MinIO bucket and access key for $SLUG =="
POLICY_FILE="$(mktemp)"
cat > "$POLICY_FILE" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:*"],
      "Resource": ["arn:aws:s3:::${BUCKET}", "arn:aws:s3:::${BUCKET}/*"]
    }
  ]
}
JSON

docker run --rm --network tenants-net \
  -v "${POLICY_FILE}:/policy.json:ro" \
  minio/mc:latest sh -c "
    mc alias set shared http://shared-minio:9000 '${SHARED_MINIO_ROOT_USER}' '${SHARED_MINIO_ROOT_PASSWORD}' &&
    mc mb --ignore-existing shared/${BUCKET} &&
    mc admin user add shared ${MINIO_ACCESS_KEY} ${MINIO_SECRET_KEY} &&
    mc admin policy create shared ${BUCKET}-only /policy.json &&
    mc admin policy attach shared ${BUCKET}-only --user ${MINIO_ACCESS_KEY}
  "
rm -f "$POLICY_FILE"

echo "== rendering $ENV_FILE =="
sed \
  -e "s|__SLUG__|${SLUG}|g" \
  -e "s|__BASE_DOMAIN__|${BASE_DOMAIN}|g" \
  -e "s|__DB_NAME__|${DB_NAME}|g" \
  -e "s|__DB_ROLE__|${DB_ROLE}|g" \
  -e "s|__DB_PASSWORD__|${DB_PASSWORD}|g" \
  -e "s|__MINIO_BUCKET__|${BUCKET}|g" \
  -e "s|__MINIO_ACCESS_KEY__|${MINIO_ACCESS_KEY}|g" \
  -e "s|__MINIO_SECRET_KEY__|${MINIO_SECRET_KEY}|g" \
  -e "s|__WS_TICKET_SECRET__|${WS_TICKET_SECRET}|g" \
  -e "s|__TOKEN_ENCRYPTION_KEY__|${TOKEN_ENCRYPTION_KEY}|g" \
  -e "s|__OAUTH_SIGNING_KEY__|${OAUTH_SIGNING_KEY}|g" \
  -e "s|__GOOGLE_OAUTH_CLIENT_ID__|${GOOGLE_OAUTH_CLIENT_ID}|g" \
  -e "s|__GOOGLE_OAUTH_CLIENT_SECRET__|${GOOGLE_OAUTH_CLIENT_SECRET}|g" \
  -e "s|__GOOGLE_WORKSPACE_DOMAIN__|${GOOGLE_WORKSPACE_DOMAIN}|g" \
  -e "s|__SEED_ADMIN_EMAIL__|${SEED_ADMIN_EMAIL}|g" \
  envs/tenant.env.template > "$ENV_FILE"

if [[ "$SKIP_APP" == true ]]; then
  echo "== --skip-app: not starting containers or touching Caddy for $SLUG =="
  exit 0
fi

echo "== building and starting stack for $SLUG =="
docker compose -p "aluno-${SLUG}" -f docker-compose.tenant.yml --env-file "$ENV_FILE" up -d --build

echo "== adding Caddy site block for $SLUG =="
{
  echo "# BEGIN TENANT ${SLUG}"
  echo "${SLUG}.{\$BASE_DOMAIN} {"
  echo "	tls {\$ACME_EMAIL}"
  echo "	@ws path /_ws*"
  echo "	reverse_proxy @ws aluno-${SLUG}-ws-1:8080"
  echo "	reverse_proxy aluno-${SLUG}-app-1:3000"
  echo "}"
  echo "# END TENANT ${SLUG}"
} >> Caddyfile.tenants
docker compose -p tenants-shared -f docker-compose.shared.yml exec caddy caddy reload --config /etc/caddy/Caddyfile

echo "== done: https://${SLUG}.${BASE_DOMAIN} =="
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/provision-tenant.sh`

- [ ] **Step 3: Run it against a real test tenant**

Run: `scripts/provision-tenant.sh smoketest smoketest@example.com`
Expected: prints each `==` section header in order, ends with `== done: https://smoketest.localtest.dev ==`, exits 0.

- [ ] **Step 4: Verify the database and role**

Run: `docker compose -p tenants-shared -f docker-compose.shared.yml exec -T postgres psql -U tenant_admin -d postgres -c "\l aluno_smoketest"`
Expected: lists `aluno_smoketest` owned by `aluno_smoketest`.

- [ ] **Step 5: Verify the bucket and containers**

Run: `docker run --rm --network tenants-net minio/mc:latest sh -c "mc alias set shared http://shared-minio:9000 tenant_admin <password-from-envs/shared.env> && mc ls shared"`
Expected: lists `aluno-smoketest/`.

Run: `docker compose -p aluno-smoketest -f docker-compose.tenant.yml --env-file envs/aluno-smoketest.env ps`
Expected: `app`, `ws`, `worker` all `running` (healthy once their `start_period` elapses).

- [ ] **Step 6: Verify the Caddy block**

Run: `docker compose -p tenants-shared -f docker-compose.shared.yml exec caddy caddy validate --config /etc/caddy/Caddyfile`
Expected: `Valid configuration` (proves the appended block is syntactically correct Caddy config, without needing real DNS/TLS for `smoketest.localtest.dev`).

- [ ] **Step 7: Commit**

```bash
git add scripts/provision-tenant.sh
git commit -m "feat: add scripts/provision-tenant.sh to create an isolated per-student stack"
```

---

### Task 4: `scripts/deprovision-tenant.sh`

**Files:**
- Create: `scripts/deprovision-tenant.sh`

**Interfaces:**
- Consumes: the same `envs/shared.env`, database/role/bucket naming convention, and `Caddyfile.tenants` markers established in Task 3.
- Produces: nothing further downstream relies on; this is a terminal operation. Task 5 calls it as its cleanup step.
- CLI: `scripts/deprovision-tenant.sh <slug> --yes-delete-data`

- [ ] **Step 1: Create `scripts/deprovision-tenant.sh`**

```bash
#!/usr/bin/env bash
# Reverses provision-tenant.sh: stops and deletes a student's stack, database, bucket, and Caddy
# block. DESTRUCTIVE: deletes the student's CRM data permanently. See docs/deploy-multi-tenant.md.
#
# Usage: scripts/deprovision-tenant.sh <slug> --yes-delete-data
set -euo pipefail

SLUG="${1:?usage: deprovision-tenant.sh <slug> --yes-delete-data}"
CONFIRM="${2:-}"

if [[ "$CONFIRM" != "--yes-delete-data" ]]; then
  echo "error: this permanently deletes ${SLUG}'s database, files, and containers." >&2
  echo "re-run with: scripts/deprovision-tenant.sh ${SLUG} --yes-delete-data" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=/dev/null
source envs/shared.env

DB_NAME="aluno_${SLUG//-/_}"
DB_ROLE="$DB_NAME"
BUCKET="aluno-${SLUG}"
MINIO_ACCESS_KEY="aluno-${SLUG}"
ENV_FILE="envs/aluno-${SLUG}.env"

echo "== stopping stack for $SLUG (idempotent if never started) =="
if [[ -f "$ENV_FILE" ]]; then
  docker compose -p "aluno-${SLUG}" -f docker-compose.tenant.yml --env-file "$ENV_FILE" down || true
fi

echo "== dropping Postgres database and role for $SLUG =="
# ON_ERROR_STOP=0: tolerate "does not exist" so this script is safe to re-run.
docker compose -p tenants-shared -f docker-compose.shared.yml exec -T postgres \
  psql -U "$SHARED_POSTGRES_ADMIN_USER" -d postgres -v ON_ERROR_STOP=0 <<SQL
DROP DATABASE IF EXISTS "${DB_NAME}";
DROP ROLE IF EXISTS "${DB_ROLE}";
SQL

echo "== removing MinIO bucket and access key for $SLUG =="
docker run --rm --network tenants-net minio/mc:latest sh -c "
  mc alias set shared http://shared-minio:9000 '${SHARED_MINIO_ROOT_USER}' '${SHARED_MINIO_ROOT_PASSWORD}'
  mc admin user remove shared ${MINIO_ACCESS_KEY} || true
  mc admin policy remove shared ${BUCKET}-only || true
  mc rb --force shared/${BUCKET} || true
"

echo "== removing Caddy site block for $SLUG =="
if grep -q "# BEGIN TENANT ${SLUG}\$" Caddyfile.tenants 2>/dev/null; then
  sed -i.bak "/# BEGIN TENANT ${SLUG}\$/,/# END TENANT ${SLUG}\$/d" Caddyfile.tenants
  rm -f Caddyfile.tenants.bak
  docker compose -p tenants-shared -f docker-compose.shared.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
fi

rm -f "$ENV_FILE"
echo "== done: ${SLUG} fully deprovisioned =="
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/deprovision-tenant.sh`

- [ ] **Step 3: Run it against the Task 3 test tenant**

Run: `scripts/deprovision-tenant.sh smoketest --yes-delete-data`
Expected: prints each `==` section, ends with `== done: smoketest fully deprovisioned ==`, exits 0.

- [ ] **Step 4: Verify everything is gone**

Run: `docker compose -p tenants-shared -f docker-compose.shared.yml exec -T postgres psql -U tenant_admin -d postgres -c "\l aluno_smoketest"`
Expected: no matching row (database no longer listed).

Run: `docker run --rm --network tenants-net minio/mc:latest sh -c "mc alias set shared http://shared-minio:9000 tenant_admin <password> && mc ls shared/aluno-smoketest"`
Expected: an error (bucket does not exist).

Run: `grep smoketest Caddyfile.tenants`
Expected: no output (block removed).

Run: `docker compose -p tenants-shared -f docker-compose.shared.yml exec caddy caddy validate --config /etc/caddy/Caddyfile`
Expected: `Valid configuration`.

- [ ] **Step 5: Commit**

```bash
git add scripts/deprovision-tenant.sh
git commit -m "feat: add scripts/deprovision-tenant.sh to tear down a student's stack"
```

---

### Task 5: `scripts/verify-tenant-isolation.sh`

**Files:**
- Create: `scripts/verify-tenant-isolation.sh`

**Interfaces:**
- Consumes: `scripts/provision-tenant.sh --skip-app` and `scripts/deprovision-tenant.sh` (Tasks 3 and 4) as its provisioning/cleanup primitives.
- Produces: an exit code (0 = isolation holds, non-zero = a leak was found), meant to be re-run after any future change to provisioning or the shared stack.

- [ ] **Step 1: Create `scripts/verify-tenant-isolation.sh`**

```bash
#!/usr/bin/env bash
# Automated check that tenant isolation actually holds: provisions two throwaway tenants,
# confirms tenant A's Postgres role cannot connect to tenant B's database and tenant A's MinIO
# key cannot read tenant B's bucket, then tears both down. Exits non-zero if either isolation
# check fails to deny access. Run this after any change to provision-tenant.sh or the shared
# stack. See docs/deploy-multi-tenant.md.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

A="isotest-a"
B="isotest-b"

cleanup() {
  scripts/deprovision-tenant.sh "$A" --yes-delete-data >/dev/null 2>&1 || true
  scripts/deprovision-tenant.sh "$B" --yes-delete-data >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== provisioning throwaway tenants $A and $B (infra only) =="
scripts/provision-tenant.sh "$A" "isotest-a@example.com" --skip-app
scripts/provision-tenant.sh "$B" "isotest-b@example.com" --skip-app

FAIL=0

DB_URL_A="$(grep '^DATABASE_URL=' "envs/aluno-${A}.env" | cut -d= -f2-)"
DB_ROLE_A="$(echo "$DB_URL_A" | sed -E 's#postgres://([^:]+):.*#\1#')"
DB_PASSWORD_A="$(echo "$DB_URL_A" | sed -E 's#postgres://[^:]+:([^@]+)@.*#\1#')"
DB_NAME_B="aluno_${B//-/_}"

echo "== checking Postgres isolation: $A must not be able to connect to ${B}'s database =="
if docker run --rm --network tenants-net -e PGPASSWORD="$DB_PASSWORD_A" postgres:16-alpine \
  psql -h shared-postgres -U "$DB_ROLE_A" -d "$DB_NAME_B" -c '\q' >/dev/null 2>&1; then
  echo "FAIL: ${A}'s role could connect to ${B}'s database"
  FAIL=1
else
  echo "PASS: ${A}'s role was denied connecting to ${B}'s database"
fi

MINIO_KEY_A="aluno-${A}"
MINIO_SECRET_A="$(grep '^MINIO_SECRET_KEY=' "envs/aluno-${A}.env" | cut -d= -f2)"
BUCKET_B="aluno-${B}"

echo "== checking MinIO isolation: ${A}'s key must not read ${B}'s bucket =="
RESULT="$(docker run --rm --network tenants-net minio/mc:latest sh -c "
  mc alias set testa http://shared-minio:9000 '${MINIO_KEY_A}' '${MINIO_SECRET_A}' >/dev/null 2>&1
  mc ls testa/${BUCKET_B} 2>&1
")"

if echo "$RESULT" | grep -qi "access denied"; then
  echo "PASS: ${A}'s key was denied listing ${B}'s bucket"
else
  echo "FAIL: ${A}'s key was NOT denied listing ${B}'s bucket (got: $RESULT)"
  FAIL=1
fi

exit $FAIL
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/verify-tenant-isolation.sh`

- [ ] **Step 3: Prove the check can actually fail (red)**

Temporarily comment out the `REVOKE CONNECT ON DATABASE ... FROM PUBLIC;` line in `scripts/provision-tenant.sh`.

Run: `scripts/verify-tenant-isolation.sh`
Expected: prints `FAIL: isotest-a's role could connect to isotest-b's database`, exits non-zero. This proves the check is a real assertion, not a tautology that always passes.

- [ ] **Step 4: Restore and confirm green**

Restore the `REVOKE CONNECT ON DATABASE ... FROM PUBLIC;` line.

Run: `scripts/verify-tenant-isolation.sh`
Expected: prints both `PASS:` lines, exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-tenant-isolation.sh
git commit -m "test: add scripts/verify-tenant-isolation.sh as the tenant isolation check"
```

---

### Task 6: Operator documentation

**Files:**
- Create: `docs/deploy-multi-tenant.md`

**Interfaces:**
- Consumes: nothing (documentation only); references every script and file from Tasks 1-5 by their final names.

- [ ] **Step 1: Create `docs/deploy-multi-tenant.md`**

```markdown
# Hosting multiple CRM Academy students on one box

Design: `docs/superpowers/specs/2026-09-05-multi-tenant-provisioning-design.md`.

Each student gets a fully isolated warpdrive instance: their own database, their own file
storage bucket, their own app/ws/worker containers, on their own subdomain. Isolation is
enforced by Postgres role grants and MinIO bucket policy, not by any code in this repo, so a bug
in the app cannot leak one student's data to another.

## One-time setup

1. Point wildcard DNS `*.{BASE_DOMAIN}` and `s3.{BASE_DOMAIN}` at this box's public IP. Wildcard
   DNS matters here specifically: it means no DNS change is needed for each new student, only
   for this one-time setup.
2. `cp envs/shared.env.example envs/shared.env` and fill it in: generate
   `SHARED_POSTGRES_ADMIN_PASSWORD` and `SHARED_MINIO_ROOT_PASSWORD` with `openssl rand -hex 24`,
   set `BASE_DOMAIN` and `ACME_EMAIL`, and set `GOOGLE_OAUTH_CLIENT_ID` /
   `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_WORKSPACE_DOMAIN` from your Google Cloud OAuth client
   (one client, shared by every student; see the caveat below).
3. `docker compose -p tenants-shared -f docker-compose.shared.yml --env-file envs/shared.env up -d`

## Adding a student

```sh
scripts/provision-tenant.sh <slug> <student-google-email>
```

Then, in the Google Cloud Console, add this student's redirect URIs to the shared OAuth client:
`https://<slug>.{BASE_DOMAIN}/api/gmail/oauth/callback` and the sign-in callback. This one step
cannot be scripted: Google requires it in their console UI.

The student's CRM is now live at `https://<slug>.{BASE_DOMAIN}`; their first Google sign-in
promotes them to admin of their own instance (same `SEED_ADMIN_EMAIL` bootstrap this project
already uses for a normal single-tenant deploy).

**Known limitation:** `GOOGLE_WORKSPACE_DOMAIN` restricts sign-in to accounts on one Google
Workspace domain. If a student signs in with a personal Gmail account rather than a Workspace
account, sign-in will fail; this is an existing constraint of the warpdrive login flow, not
something this provisioning tooling changes. Confirm your students' account type before their
first login.

## Removing a student

```sh
scripts/deprovision-tenant.sh <slug> --yes-delete-data
```

This is destructive and permanent: it drops the student's database, deletes their bucket, and
stops their containers. Also remove their redirect URIs from the Google Cloud Console.

## Verifying isolation

Run `scripts/verify-tenant-isolation.sh` after any change to `scripts/provision-tenant.sh` or the
shared stack. It provisions two throwaway tenants, proves neither can read the other's database
or bucket, then tears both down. A clean exit (0) with two `PASS:` lines is the only acceptable
result before deploying a provisioning change to real students.

## Backups

All student databases live in the one `shared_pgdata` volume (one shared Postgres instance), so
one dump covers everyone:

```sh
docker compose -p tenants-shared -f docker-compose.shared.yml exec -T postgres \
  pg_dumpall -U tenant_admin | gzip > backup-$(date +%F).sql.gz
```

Uploaded files live in the `shared_miniodata` volume; back that up too.

## Migrating a student off this box later

When a student's cohort funds a dedicated VPS (see the CRM Academy plan this design implements),
that student stops being special-cased here: `pg_dump` their database, `mc mirror` their bucket,
restore both on the dedicated box, point a normal single-tenant `docker-compose.yml` deploy
(`docs/deploy.md`) at them, then `scripts/deprovision-tenant.sh` them from the shared box.
```

- [ ] **Step 2: Review against the spec**

Re-read `docs/superpowers/specs/2026-09-05-multi-tenant-provisioning-design.md` section by section and confirm this doc's one-time setup, add-student, remove-student, verify, and backup sections each map to a spec requirement. Fix any gap found.

- [ ] **Step 3: Commit**

```bash
git add docs/deploy-multi-tenant.md
git commit -m "docs: add multi-tenant hosting runbook for CRM Academy students"
```
