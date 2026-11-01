#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_URL:?Set DATABASE_URL to the database being backed up}"
: "${BACKUP_AGE_RECIPIENT:?Set BACKUP_AGE_RECIPIENT; plaintext backups are not written by this script}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/3d-commerce}"
command -v pg_dump >/dev/null || { echo 'pg_dump is required' >&2; exit 1; }
command -v age >/dev/null || { echo 'age is required' >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp "$BACKUP_DIR/.pgdump.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
OUT="$BACKUP_DIR/postgres-$STAMP.dump.age"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$TMP"
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$OUT" "$TMP"
sha256sum "$OUT" > "$OUT.sha256"
chmod 600 "$OUT" "$OUT.sha256"
printf 'Encrypted PostgreSQL backup written: %s\n' "$OUT"
printf 'Copy both the backup and checksum off-host; do not store the decryption key on this VPS.\n'
