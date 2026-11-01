# Backup and restore runbook

## Critical data

Back up PostgreSQL and protect the R2 object data separately. Database backups alone do not contain 3D models or images. The live VPS must never be the only copy. Store encrypted backups outside the VPS under a restricted service account, with retention and deletion aligned to an approved policy.

## Local encrypted backup example

The provided `infrastructure/scripts/backup-postgres.sh` uses `pg_dump` in custom format and encrypts it with `age` when `BACKUP_AGE_RECIPIENT` is configured. It intentionally stops if the tools or key are missing. The script expects a connection string in `DATABASE_URL`; avoid passing secrets as command-line arguments. Restrict the directory and monitor free disk space. Upload the resulting `.dump.age` file using your chosen off-site storage provider and verify its checksum.

Example environment for the script:

```sh
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require'
export BACKUP_DIR=/var/backups/3d-commerce
export BACKUP_AGE_RECIPIENT='age1...'
./infrastructure/scripts/backup-postgres.sh
```

Store no private recovery keys on the same VPS as the encrypted backups. Keep the age identity or other decryption key in a separate controlled location.

## Restore drill

1. Select a known backup and validate its checksum.
2. Decrypt to a restricted temporary directory on a secure host.
3. Restore into a new, empty, isolated database. Do not restore over production during a drill.
4. Run migrations only if the recovery plan calls for it; first inspect the restored schema/release compatibility.
5. Verify expected record counts, users, products, order history, payment references, and constraints.
6. Confirm object keys in the database have matching objects in R2; test retrieval using authorized, short-lived signed URLs.
7. Record duration, failures, data-loss window, and remediation. Repeat after material backup-system changes.

The sample `restore-postgres.sh` refuses to run unless the operator supplies a target database connection and an explicit confirmation flag. A restore test has **not** been executed in the current environment.

## R2 recovery

Configure object lifecycle/retention and versioning or a separate copy process if appropriate for the account plan and current Cloudflare capabilities. Test retrieval/restoration of a sample product asset and a private model object. Do not make private customer files public as a recovery shortcut.
