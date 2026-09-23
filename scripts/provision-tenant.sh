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
set -a
source envs/shared.env
set +a

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
OAUTH_SIGNING_KEY="$(openssl rand -base64 32)"
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
  --entrypoint sh \
  -v "${POLICY_FILE}:/policy.json:ro" \
  quay.io/minio/mc:latest -c "
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
  -e "s|__RESEND_API_KEY__|${RESEND_API_KEY:-}|g" \
  -e "s|__MAGIC_LINK_FROM_EMAIL__|${MAGIC_LINK_FROM_EMAIL:-}|g" \
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
  echo "http://${SLUG}.{\$BASE_DOMAIN} {"
  echo "	header {"
  echo "		Strict-Transport-Security \"max-age=31536000; includeSubDomains\""
  echo "		-Server"
  echo "	}"
  echo "	request_body {"
  echo "		max_size 80MB"
  echo "	}"
  echo "	@ws path /_ws*"
  echo "	reverse_proxy @ws aluno-${SLUG}-ws-1:8080"
  echo "	reverse_proxy aluno-${SLUG}-app-1:3000"
  echo "}"
  echo "# END TENANT ${SLUG}"
} >> caddy/Caddyfile.tenants
docker compose -p tenants-shared -f docker-compose.shared.yml exec caddy caddy reload --config /etc/caddy/Caddyfile.tenants

echo "== done: https://${SLUG}.${BASE_DOMAIN} =="
