#!/usr/bin/env bash
# Daily backup for the multi-tenant hosting: one pg_dumpall covers every student's database
# (all in the single shared Postgres instance), plus the MinIO data volume (every student's
# uploaded files), plus every envs/aluno-*.env (each holds a TOKEN_ENCRYPTION_KEY that is not
# stored anywhere else; losing it without the matching env file leaves that student's stored
# Gmail OAuth tokens permanently unrecoverable, see docs/deploy-multi-tenant.md "Backups").
# 7-day retention, applied to files this script itself created (by filename pattern), so it
# never deletes a backup dropped there by something else.
#
# Run via cron; not meant to be run with output attached to a terminal.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/warpdrive-tenants}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DATE="$(date +%F)"

cd "$ROOT_DIR"
# shellcheck source=/dev/null
set -a
source envs/shared.env
set +a

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "== $(date -Iseconds): pg_dumpall (all tenant databases) =="
docker compose -p tenants-shared -f docker-compose.shared.yml exec -T postgres \
  pg_dumpall -U "$SHARED_POSTGRES_ADMIN_USER" | gzip > "$BACKUP_DIR/postgres-${DATE}.sql.gz"

echo "== $(date -Iseconds): MinIO data volume =="
MINIO_VOLUME_DIR="$(docker volume inspect tenants-shared_shared_miniodata -f '{{.Mountpoint}}')"
tar -czf "$BACKUP_DIR/minio-${DATE}.tar.gz" -C "$MINIO_VOLUME_DIR" .

echo "== $(date -Iseconds): envs/ (shared.env + every aluno-*.env) =="
tar -czf "$BACKUP_DIR/envs-${DATE}.tar.gz" -C "$ROOT_DIR" envs

# Housekeeping, not a backup: each new tenant's build (docker-compose.tenant.yml, one image set
# per student, never shared) leaves BuildKit cache behind that mostly never gets reused once that
# student is provisioned. Left alone this grows without bound as students churn. 7 days keeps
# same-week rebuild speed (re-provisioning after a quick deprovision/reprovision, or iterating on
# the Dockerfile) without accumulating forever.
echo "== $(date -Iseconds): pruning docker build cache older than 7 days =="
docker builder prune -f --filter "until=168h" >/dev/null

echo "== $(date -Iseconds): pruning backups older than ${RETENTION_DAYS} days =="
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'postgres-*.sql.gz' -o -name 'minio-*.tar.gz' -o -name 'envs-*.tar.gz' \) -mtime "+${RETENTION_DAYS}" -print -delete

echo "== $(date -Iseconds): done =="
