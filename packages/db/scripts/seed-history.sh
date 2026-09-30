#!/usr/bin/env bash
# Adds thirty days of sales history to the sample shop (run db:reset and db:seed first). Opt-in: CI's browser tests
# assume a shop that has sold nothing. See the header of packages/db/sql/seed-history.sql for what it does and why.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB="${SABAI_DB:-sabai_dev}"
export PGHOST="${PGHOST:-localhost}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
export PGOPTIONS='-c client_min_messages=warning'
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f packages/db/sql/seed-history.sql
