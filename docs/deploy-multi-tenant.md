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
shared stack. It provisions two throwaway tenants and proves tenant A cannot read tenant B's
database or bucket, then tears both down. Only that one direction is tested: both tenants are
provisioned by the identical code path, so a regression that broke isolation would show up
regardless of which tenant is cast as the attacker. A clean exit (0) with two `PASS:` lines is the
only acceptable result before deploying a provisioning change to real students.

## Backups

All student databases live in the one `shared_pgdata` volume (one shared Postgres instance), so
one dump covers everyone:

```sh
set -a; source envs/shared.env; set +a
docker compose -p tenants-shared -f docker-compose.shared.yml exec -T postgres \
  pg_dumpall -U "$SHARED_POSTGRES_ADMIN_USER" | gzip > backup-$(date +%F).sql.gz
```

Uploaded files live in the `shared_miniodata` volume; back that up too.

Also back up `envs/aluno-*.env` alongside the database dump. Each tenant's `TOKEN_ENCRYPTION_KEY`
lives only in that tenant's env file, and it's the key used to encrypt that tenant's Gmail OAuth
tokens stored in Postgres. Restoring a Postgres dump without the matching `envs/aluno-<slug>.env`
leaves that tenant's encrypted tokens permanently unrecoverable — re-provisioning generates a
brand-new key that cannot decrypt the old data.

## Migrating a student off this box later

When a student's cohort funds a dedicated VPS (see the CRM Academy plan this design implements),
that student stops being special-cased here: `pg_dump` their database, `mc mirror` their bucket,
restore both on the dedicated box, point a normal single-tenant `docker-compose.yml` deploy
(`docs/deploy.md`) at them, then `scripts/deprovision-tenant.sh` them from the shared box.
