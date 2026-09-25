#!/usr/bin/env bash
# Recovery for a student locked out of their tenant: magic-link login has no password and no
# self-service "forgot my email" (email IS the identity, see src/features/auth/magicLink.ts), so
# losing access to that inbox means losing the only way in. This is the manual fix: update the
# ONE existing user row's email (and its synthetic magiclink-<email> sub in the same statement,
# which MUST stay in sync with the email or upsertUserOnLogin, unable to match either the old sub
# or the new email, would silently create a second, separate, non-admin user instead of
# recognizing this as the same person on their next login).
#
# Verify who you're talking to before running this (e.g. cross-check envs/aluno-<slug>.env's
# SEED_ADMIN_EMAIL or the original crm_compras row against whatever they can prove) — this
# script does not, and cannot, verify identity for you.
#
# Only rebinds an EXISTING magic-link user (google_sub already 'magiclink-<old-email>'); refuses
# for a Google-OAuth user (a real Google sub) since that account recovers through Google instead.
#
# Usage: scripts/reset-tenant-login-email.sh <slug> <old-email> <new-email>
set -euo pipefail

SLUG="${1:?usage: reset-tenant-login-email.sh <slug> <old-email> <new-email>}"
OLD_EMAIL="${2:?usage: reset-tenant-login-email.sh <slug> <old-email> <new-email>}"
NEW_EMAIL="${3:?usage: reset-tenant-login-email.sh <slug> <old-email> <new-email>}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=/dev/null
set -a
source envs/shared.env
set +a

DB_NAME="aluno_${SLUG//-/_}"
OLD_SUB="magiclink-${OLD_EMAIL}"
NEW_SUB="magiclink-${NEW_EMAIL}"

echo "== ${SLUG}: rebinding ${OLD_EMAIL} -> ${NEW_EMAIL} =="
RESULT="$(docker exec -i shared-postgres psql -U "$SHARED_POSTGRES_ADMIN_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qtA <<SQL
UPDATE users SET email = '${NEW_EMAIL}', google_sub = '${NEW_SUB}'
WHERE email = '${OLD_EMAIL}' AND google_sub = '${OLD_SUB}'
RETURNING id;
SQL
)"

if [[ -z "$RESULT" ]]; then
  echo "error: no row matched email='${OLD_EMAIL}' with a magic-link google_sub in ${DB_NAME}." >&2
  echo "Either the email is wrong, or this user signs in with Google (recovers through Google instead, not this script)." >&2
  exit 1
fi

echo "== done: user ${RESULT} in ${SLUG} now signs in with ${NEW_EMAIL} =="
