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
# set -a: export every var from shared.env so docker compose --env-file interpolation
# (e.g. ${BASE_DOMAIN} in Caddyfile.tenants reload) and the psql/mc commands below see them.
set -a
source envs/shared.env
set +a

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
# --entrypoint sh: the minio/mc image's default entrypoint is `mc` itself, so `sh -c "..."`
# needs the entrypoint overridden or it tries to run `mc` with "sh" as its first argument.
docker run --rm --network tenants-net --entrypoint sh minio/mc:latest -c "
  set -e
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
