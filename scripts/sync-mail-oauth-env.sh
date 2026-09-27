#!/usr/bin/env bash
# Copy the fleet-wide mailbox OAuth settings from envs/shared.env into every existing tenant env
# file (envs/aluno-*.env), with MAIL_OAUTH_RELAY_SECRET derived per tenant, replacing the value
# when the key is already there and appending it otherwise, then drop the retired NYLAS_* keys. Tenants provisioned from now on get them from
# envs/tenant.env.template; this is for the ones created before.
#
# Usage (repo root, on the VPS):  scripts/sync-mail-oauth-env.sh [--restart]
#   --restart  also recreate each tenant's app/worker containers so they pick the values up.
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source envs/shared.env

KEYS=(GMAIL_OAUTH_CLIENT_ID GMAIL_OAUTH_CLIENT_SECRET MICROSOFT_OAUTH_CLIENT_ID MICROSOFT_OAUTH_CLIENT_SECRET MAIL_OAUTH_RELAY_SECRET)
MASTER_RELAY_SECRET="${MAIL_OAUTH_RELAY_SECRET:-}"
RESTART=false
[[ "${1:-}" == "--restart" ]] && RESTART=true

shopt -s nullglob
for file in envs/aluno-*.env; do
  slug="${file#envs/aluno-}"; slug="${slug%.env}"
  # Tenants hold HMAC(master, slug), never the master secret (mail-oauth-relay/lib.mjs tenantSecret).
  MAIL_OAUTH_RELAY_SECRET=""
  if [[ -n "$MASTER_RELAY_SECRET" ]]; then
    MAIL_OAUTH_RELAY_SECRET="$(printf '%s' "$slug" | openssl dgst -sha256 -hmac "$MASTER_RELAY_SECRET" | sed 's/^.*= //')"
  fi
  tmp="$(mktemp)"
  grep -v -E '^NYLAS_(API_KEY|CLIENT_ID|REGION)=' "$file" > "$tmp" || true
  for key in "${KEYS[@]}"; do
    value="${!key:-}"
    if grep -q -E "^${key}=" "$tmp"; then
      # awk, not sed: secrets may contain characters sed would treat as syntax.
      awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$tmp" > "$tmp.new"
      mv "$tmp.new" "$tmp"
    else
      printf '%s=%s\n' "$key" "$value" >> "$tmp"
    fi
  done
  chmod --reference="$file" "$tmp" 2>/dev/null || chmod 600 "$tmp"
  mv "$tmp" "$file"
  echo "updated $file"
  if [[ "$RESTART" == true ]]; then
    docker compose -p "aluno-${slug}" -f docker-compose.tenant.yml --env-file "$file" up -d app worker
  fi
done
