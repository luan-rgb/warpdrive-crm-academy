#!/usr/bin/env bash
# Automated check that tenant isolation actually holds: provisions two throwaway tenants,
# confirms tenant A's Postgres role cannot connect to tenant B's database and tenant A's MinIO
# key cannot read tenant B's bucket, then tears both down. Exits non-zero if either isolation
# check fails to deny access. Run this after any change to provision-tenant.sh or the shared
# stack. See docs/deploy-multi-tenant.md.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

A="isotest-a-$$"
B="isotest-b-$$"

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

echo "== positive control: ${A}'s own credentials must actually work =="
docker run --rm --network tenants-net -e PGPASSWORD="$DB_PASSWORD_A" postgres:16-alpine \
  psql -h shared-postgres -U "$DB_ROLE_A" -d "aluno_${A//-/_}" -c '\q' >/dev/null 2>&1 \
  || { echo "FAIL: control connection to ${A}'s own database failed; check is not meaningful"; exit 1; }

echo "== checking Postgres isolation: $A must not be able to connect to ${B}'s database =="
# Assert the specific Postgres denial message, not just a nonzero exit code: a wrong
# password, wrong host, or network hiccup also makes psql exit nonzero, which would
# read as a false PASS if we only checked the exit status (as the MinIO check below
# already does correctly via `grep -qi "access denied"`).
PG_OUT="$(docker run --rm --network tenants-net -e PGPASSWORD="$DB_PASSWORD_A" postgres:16-alpine \
  psql -h shared-postgres -U "$DB_ROLE_A" -d "$DB_NAME_B" -c '\q' 2>&1 || true)"
if echo "$PG_OUT" | grep -qi "permission denied for database"; then
  echo "PASS: ${A}'s role was denied connecting to ${B}'s database"
else
  echo "FAIL: ${A}'s role was not denied by permission (got: $PG_OUT)"
  FAIL=1
fi
# Only A->B is tested here, not B->A: both directions are provisioned by the same
# provision-tenant.sh code path (same REVOKE/GRANT logic per tenant), so testing one
# direction is sufficient to catch a regression in that shared logic.

MINIO_KEY_A="aluno-${A}"
MINIO_SECRET_A="$(grep '^MINIO_SECRET_KEY=' "envs/aluno-${A}.env" | cut -d= -f2)"
BUCKET_B="aluno-${B}"

echo "== checking MinIO isolation: ${A}'s key must not read ${B}'s bucket =="
# --entrypoint sh: the minio/mc image's default entrypoint is `mc` itself, so a plain
# `sh -c "..."` command arg would run as `mc sh -c "..."` and fail. Same fix already applied
# in provision-tenant.sh and deprovision-tenant.sh for the same reason.
# `|| true`: `mc ls` exits non-zero on "access denied", which is the isolation-holds (success)
# case here. Under `set -e`, an unguarded failing command substitution would abort the whole
# script before the PASS/FAIL check below ever runs, so the failure must be swallowed and the
# captured output inspected instead.
RESULT="$(docker run --rm --network tenants-net --entrypoint sh minio/mc:latest -c "
  mc alias set testa http://shared-minio:9000 '${MINIO_KEY_A}' '${MINIO_SECRET_A}' >/dev/null 2>&1
  mc ls testa/${BUCKET_B} 2>&1
" || true)"

if echo "$RESULT" | grep -qi "access denied"; then
  echo "PASS: ${A}'s key was denied listing ${B}'s bucket"
else
  echo "FAIL: ${A}'s key was NOT denied listing ${B}'s bucket (got: $RESULT)"
  FAIL=1
fi

exit $FAIL
