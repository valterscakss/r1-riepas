#!/usr/bin/env bash
# Clone the Supabase database (schema + all data) into the local Docker Postgres.
#
# Usage:
#   SUPABASE_DB_URL="postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
#     tools/db/clone-supabase.sh
#
# Env:
#   SUPABASE_DB_URL  source connection string (Supabase → Connect → Session pooler, port 5432)
#   LOCAL_DB_URL     target (default: the docker-compose `db` service)
#   SCHEMAS          schemas to copy, space-separated (default: "public")
#   SOURCE_SSLMODE   sslmode for the source (default: require)
#
# pg_dump/psql run inside the postgres:17 image, so no local client version
# mismatch with Supabase's server. The local target schemas are dropped and
# recreated — never point LOCAL_DB_URL at production.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
LOCAL_DB_URL="${LOCAL_DB_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
SCHEMAS="${SCHEMAS:-public}"
IMAGE="${PG_IMAGE:-postgres:17}"
DUMP="$(mktemp -t supabase-dump.XXXXXX.sql)"
trap 'rm -f "$DUMP"' EXIT   # the dump holds customer data — don't leave it around

cd "$(dirname "$0")/../.."
docker compose up -d --wait db

pg() { docker run --rm -i --network host -e PGSSLMODE "$IMAGE" "$@"; }

schema_args=()
for s in $SCHEMAS; do schema_args+=(--schema="$s"); done

echo "Dumping ${SCHEMAS} from Supabase…"
PGSSLMODE="${SOURCE_SSLMODE:-require}" pg pg_dump "$SUPABASE_DB_URL" "${schema_args[@]}" \
  --no-owner --no-privileges --no-publications --no-subscriptions --quote-all-identifiers > "$DUMP"

echo "Restoring into ${LOCAL_DB_URL%%@*}@…"
{
  for s in $SCHEMAS; do echo "DROP SCHEMA IF EXISTS \"$s\" CASCADE;"; done
  cat "$DUMP"
} | PGSSLMODE=disable pg psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -q >/dev/null

PGSSLMODE=disable pg psql "$LOCAL_DB_URL" -q -c ANALYZE
echo "Row counts:"
PGSSLMODE=disable pg psql "$LOCAL_DB_URL" -At -c "
  SELECT schemaname || '.' || relname || ': ' || n_live_tup
  FROM pg_stat_user_tables ORDER BY 1;" || true
echo "Done."
