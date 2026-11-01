#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to an empty, isolated target database}"
: "${BACKUP_FILE:?Set BACKUP_FILE to a .dump.age file}"
: "${AGE_IDENTITY_FILE:?Set AGE_IDENTITY_FILE to the protected age identity file}"
if [[ "${CONFIRM_RESTORE:-}" != "I_HAVE_VERIFIED_THE_TARGET" ]]; then
  echo 'Refusing restore. Set CONFIRM_RESTORE=I_HAVE_VERIFIED_THE_TARGET after verifying the target database.' >&2
  exit 2
fi
command -v pg_restore >/dev/null || { echo 'pg_restore is required' >&2; exit 1; }
command -v age >/dev/null || { echo 'age is required' >&2; exit 1; }
[[ -r "$BACKUP_FILE" ]] || { echo 'Backup file is not readable' >&2; exit 1; }
[[ -r "$AGE_IDENTITY_FILE" ]] || { echo 'Age identity file is not readable' >&2; exit 1; }
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$TMP" "$BACKUP_FILE"
# --clean is intentionally omitted: operators must prepare an empty isolated DB.
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-acl --exit-on-error "$TMP"
echo 'Restore command completed. Verify schema, records, constraints, and R2 object availability; this script does not attest data integrity.'
