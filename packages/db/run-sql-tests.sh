#!/usr/bin/env bash
# Builds a throw-away database from the migrations and runs every SQL test in it.
# Requires a local Postgres 15+ (PGHOST/PGUSER/PGPASSWORD respected).
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${SABAI_TEST_DB:-sabai_test}"
export PGHOST="${PGHOST:-localhost}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
export PGOPTIONS='-c client_min_messages=warning'

psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f packages/db/sql/local-supabase-shim.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
for t in packages/db/tests/*.sql; do
  echo "▶ $t"
  psql -q -v ON_ERROR_STOP=1 -o /dev/null -d "$DB" -f "$t"
done
echo "✔ all SQL tests passed"
