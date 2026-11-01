#!/bin/sh
set -eu

: "${POSTGRES_USER:?Postgres bootstrap administrator is required}"
: "${POSTGRES_DB:?Postgres database name is required}"
: "${APP_DB_USER:?Set APP_DB_USER for the least-privilege application role}"
: "${APP_DB_PASSWORD:?Set APP_DB_PASSWORD for the least-privilege application role}"

if [ "$APP_DB_USER" = "$POSTGRES_USER" ]; then
  echo 'APP_DB_USER must differ from the PostgreSQL bootstrap administrator.' >&2
  exit 1
fi

case "$APP_DB_USER" in
  ''|*[!A-Za-z0-9_]*|[0-9]*)
    echo 'APP_DB_USER must begin with a letter or underscore and contain only letters, digits, or underscores.' >&2
    exit 1
    ;;
esac

# psql variables are SQL-literal quoted by :'name'; identifiers are quoted by format('%I').
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=app_user="$APP_DB_USER" --set=app_pass="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user')
\gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user')
\gexec
SQL
