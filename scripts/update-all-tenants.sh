#!/usr/bin/env bash
# Rolls a new version of the code out to the whole multi-tenant box, after `git pull` in
# ~/warpdrive. Order matters and the script stops at the first failure:
#   1. backup (scripts/backup-tenants.sh), so a bad migration can be undone;
#   2. shared stack (Postgres, MinIO, Caddy, mail relay) with the new config;
#   3. scripts/sync-mail-oauth-env.sh (per-tenant relay secret and mailbox OAuth settings);
#   4. each tenant, one at a time: rebuild + up; its `migrate` service applies new migrations;
#   5. a health check per tenant, summarised at the end.
#
# Usage (repo root, on the VPS):
#   scripts/update-all-tenants.sh [--dry-run] [--only <slug>]
#     --dry-run      print every command instead of running it
#     --only <slug>  update just this tenant (try it on your own tenant first)
set -euo pipefail

DRY_RUN=false
ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --only) ONLY="${2:?--only needs a slug}"; shift 2 ;;
    *) echo "error: unknown argument $1" >&2; exit 1 ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=/dev/null
set -a
source envs/shared.env
set +a

run() {
  echo "+ $*"
  if [[ "$DRY_RUN" == false ]]; then "$@"; fi
}

shopt -s nullglob
tenant_envs=(envs/aluno-*.env)
if [[ -n "$ONLY" ]]; then
  if [[ ! -f "envs/aluno-${ONLY}.env" ]]; then
    echo "error: envs/aluno-${ONLY}.env not found" >&2
    exit 1
  fi
  tenant_envs=("envs/aluno-${ONLY}.env")
fi

echo "== backup =="
run scripts/backup-tenants.sh

echo "== shared stack =="
# The paid Nylas relay was replaced by mail-oauth-relay on the same host port.
if [[ "$DRY_RUN" == false ]] && docker ps -a --format '{{.Names}}' | grep -qx shared-nylas-relay; then
  run docker rm -f shared-nylas-relay
fi
run docker compose -p tenants-shared -f docker-compose.shared.yml --env-file envs/shared.env up -d --build

echo "== tenant env sync =="
run scripts/sync-mail-oauth-env.sh

slugs=()
for env_file in "${tenant_envs[@]}"; do
  slug="${env_file#envs/aluno-}"
  slug="${slug%.env}"
  slugs+=("$slug")
  echo "== tenant $slug =="
  run docker compose -p "aluno-${slug}" -f docker-compose.tenant.yml --env-file "$env_file" up -d --build
done

echo "== health =="
failed=0
for slug in "${slugs[@]}"; do
  url="https://${slug}.${BASE_DOMAIN}/api/health"
  if [[ "$DRY_RUN" == true ]]; then
    echo "+ curl -fsS $url"
    continue
  fi
  # The app needs a few seconds after `up -d` to finish booting.
  ok=false
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "$url"; then ok=true; break; fi
    sleep 2
  done
  if [[ "$ok" == true ]]; then echo "OK      $slug"; else echo "FALHOU  $slug ($url)"; failed=1; fi
done

exit "$failed"
