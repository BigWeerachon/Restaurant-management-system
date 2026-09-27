#!/usr/bin/env bash
# Recreates the local development database from migrations (+ demo seed if present).
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB="${SABAI_DB:-sabai_dev}"
export PGHOST="${PGHOST:-localhost}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
export PGOPTIONS='-c client_min_messages=warning'
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f packages/db/sql/local-supabase-shim.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
echo "✔ ${DB} ready"
