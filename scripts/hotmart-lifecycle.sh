#!/usr/bin/env bash
# Daily lifecycle for CRM Academy purchases (Hotmart -> warpdrive tenant).
#
# Reads/writes the EXISTING crm_compras table in the main Supabase Postgres (populated by the
# crm-hotmart edge function at /opt/supabase/app/volumes/functions/crm-hotmart, which already
# validates the hottok and handles PURCHASE_APPROVED/CANCELED/REFUNDED/CHARGEBACK/etc). This
# script owns everything downstream of that for CRM Academy specifically:
#   1. Delivery: provisions a warpdrive tenant (instead of crm-entregar's code-based flow, which
#      explicitly excludes CRM Academy rows now, see that function's own comment).
#   2. Suspension when Hotmart later marks a delivered purchase cancelada/reembolsada.
#   3. Suspension when the free year (warpdrive_expires_at) has passed.
#   4. A warning email 30 days before that expiry.
# Never deletes a tenant or its data; only `docker compose stop`. Deprovisioning stays a manual,
# confirmed action (scripts/deprovision-tenant.sh), same as for any other tenant.
#
# Run daily via cron (see the crontab entry alongside backup-tenants.sh). Requires the
# crm_compras.warpdrive_* columns (see docs/deploy-multi-tenant.md "Hotmart lifecycle").
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${LOG_FILE:-/var/log/warpdrive/hotmart-lifecycle.log}"
ADMIN_EMAIL="${ADMIN_EMAIL:-luanmarcelino19@gmail.com}"
PRODUCT_FILTER="%CRM Academy%"
SUPABASE_DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"

cd "$ROOT_DIR"
# shellcheck source=/dev/null
set -a
source envs/shared.env
set +a

mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "== $(date -Iseconds): hotmart-lifecycle run start =="

# -qtA: quiet, tuples-only, unaligned (script-friendly); -F tab: one clean separator per row.
psql_db() {
  docker exec -i "$SUPABASE_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA -F $'\t' "$@"
}

send_email() {
  local to="$1" subject="$2" html="$3"
  local payload
  payload="$(jq -n --arg from "$MAGIC_LINK_FROM_EMAIL" --arg to "$to" --arg subject "$subject" --arg html "$html" \
    '{from: $from, to: [$to], subject: $subject, html: $html}')"
  curl -sS -o /dev/null -w "%{http_code}" https://api.resend.com/emails \
    -H "Authorization: Bearer ${RESEND_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

notify_admin_failure() {
  local context="$1" detail="$2"
  echo "FAILURE: ${context}: ${detail}"
  local html
  html="$(printf '<p>%s</p><pre>%s</pre>' "$context" "$detail")"
  send_email "$ADMIN_EMAIL" "[warpdrive] falha: ${context}" "$html" >/dev/null || true
}

# Same channel as notify_admin_failure, but for an expected event worth knowing about (a refund
# suspended someone), not a bug. Separate subject line so "falha" doesn't cry wolf in the inbox.
notify_admin_info() {
  local context="$1" detail="$2"
  echo "INFO: ${context}: ${detail}"
  local html
  html="$(printf '<p>%s</p><pre>%s</pre>' "$context" "$detail")"
  send_email "$ADMIN_EMAIL" "[warpdrive] ${context}" "$html" >/dev/null || true
}

# Lowercase, strip accents, collapse anything non [a-z0-9] into one hyphen, trim, cap length.
slugify() {
  echo "$1" | iconv -f utf8 -t ascii//TRANSLIT 2>/dev/null | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//' | cut -c1-24 | sed -E 's/-+$//'
}

unique_slug() {
  local base="${1:-aluno}" candidate n
  [[ -z "$base" ]] && base="aluno"
  candidate="$base"
  n=2
  while [[ -n "$(psql_db -c "SELECT 1 FROM crm_compras WHERE warpdrive_slug = '${candidate}' LIMIT 1")" ]]; do
    candidate="${base}-${n}"
    n=$((n + 1))
  done
  echo "$candidate"
}

echo "-- deliver: aprovadas, entregar_em passado, ainda nao provisionadas --"
psql_db -c "
  SELECT id, comprador_email, comprador_nome
  FROM crm_compras
  WHERE status = 'aprovada' AND entregue = false AND warpdrive_status = 'pendente'
    AND entregar_em <= now() AND produto_nome ILIKE '${PRODUCT_FILTER}'
  LIMIT 50
" | while IFS=$'\t' read -r id email nome; do
  [[ -z "$id" ]] && continue
  slug="$(unique_slug "$(slugify "${nome:-aluno}")")"

  echo "provisioning ${slug} for ${email} (compra ${id})"
  if ! scripts/provision-tenant.sh "$slug" "$email"; then
    notify_admin_failure "provisionamento de ${email} (compra ${id})" "provision-tenant.sh ${slug} falhou, veja ${LOG_FILE}"
    continue
  fi

  expires_at="$(date -u -d '+365 days' '+%Y-%m-%dT%H:%M:%SZ')"
  psql_db -c "
    UPDATE crm_compras SET
      entregue = true, entregue_em = now(),
      warpdrive_slug = '${slug}', warpdrive_status = 'provisionado',
      warpdrive_provisioned_at = now(), warpdrive_expires_at = '${expires_at}'
    WHERE id = '${id}'
  " >/dev/null

  url="https://${slug}.crm.estrategistacrm.com.br"
  html="$(printf '<p>Ol\xc3\xa1%s! Seu CRM est\xc3\xa1 pronto: <a href="%s">%s</a></p><p>Entre com o e-mail <strong>%s</strong> (o mesmo da compra) \xe2\x80\x94 a tela de login manda um link de acesso pra esse e-mail, sem precisar de senha.</p>' \
    "${nome:+, $nome}" "$url" "$url" "$email")"
  status_code="$(send_email "$email" "Seu CRM da Estrategista est\xc3\xa1 pronto" "$html")"
  if [[ "$status_code" != 2* ]]; then
    notify_admin_failure "e-mail de boas-vindas para ${email}" "Resend retornou ${status_code}"
  fi
done

echo "-- suspend: reembolsadas/canceladas depois de provisionadas --"
psql_db -c "
  SELECT id, warpdrive_slug, comprador_email
  FROM crm_compras
  WHERE warpdrive_status = 'provisionado' AND status IN ('cancelada', 'reembolsada')
" | while IFS=$'\t' read -r id slug email; do
  [[ -z "$id" ]] && continue
  echo "suspending ${slug} (compra ${id}: status virou cancelamento/reembolso)"
  env_file="envs/aluno-${slug}.env"
  if [[ -f "$env_file" ]] && docker compose -p "aluno-${slug}" -f docker-compose.tenant.yml --env-file "$env_file" stop; then
    psql_db -c "UPDATE crm_compras SET warpdrive_status = 'suspenso' WHERE id = '${id}'" >/dev/null
    notify_admin_info "aluno suspenso por reembolso/cancelamento" "slug=${slug} email=${email} (dados preservados, nada apagado)"
  else
    notify_admin_failure "suspensao de ${slug} falhou" "docker compose stop nao rodou (compra ${id}); tenant pode seguir consumindo recursos"
  fi
done

echo "-- suspend: expirou o ano gratuito --"
psql_db -c "
  SELECT id, warpdrive_slug
  FROM crm_compras
  WHERE warpdrive_status = 'provisionado' AND warpdrive_expires_at <= now()
" | while IFS=$'\t' read -r id slug; do
  [[ -z "$id" ]] && continue
  echo "suspending ${slug} (compra ${id}: expirou o ano gratuito)"
  env_file="envs/aluno-${slug}.env"
  if [[ -f "$env_file" ]] && docker compose -p "aluno-${slug}" -f docker-compose.tenant.yml --env-file "$env_file" stop; then
    psql_db -c "UPDATE crm_compras SET warpdrive_status = 'suspenso' WHERE id = '${id}'" >/dev/null
  else
    notify_admin_failure "suspensao por expiracao de ${slug} falhou" "docker compose stop nao rodou (compra ${id})"
  fi
done

echo "-- avisa quem vence em ate 30 dias --"
psql_db -c "
  SELECT id, warpdrive_slug, comprador_email, comprador_nome
  FROM crm_compras
  WHERE warpdrive_status = 'provisionado' AND warpdrive_warned_at IS NULL
    AND warpdrive_expires_at <= now() + interval '30 days'
" | while IFS=$'\t' read -r id slug email nome; do
  [[ -z "$id" ]] && continue
  url="https://${slug}.crm.estrategistacrm.com.br"
  html="$(printf '<p>Ol\xc3\xa1%s! Seu ano gr\xc3\xa1tis no CRM (<a href="%s">%s</a>) vence em at\xc3\xa9 30 dias. Depois disso o acesso \xc3\xa9 suspenso (nada \xc3\xa9 apagado, reative quando quiser).</p>' \
    "${nome:+, $nome}" "$url" "$url")"
  send_email "$email" "Seu CRM vence em 30 dias" "$html" >/dev/null || true
  psql_db -c "UPDATE crm_compras SET warpdrive_warned_at = now() WHERE id = '${id}'" >/dev/null
done

echo "== $(date -Iseconds): hotmart-lifecycle run end =="
