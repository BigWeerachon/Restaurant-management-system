#!/usr/bin/env bash
# Seeds the sample shop into an already-migrated database (run db:reset first).
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB="${SABAI_DB:-sabai_dev}"
export PGHOST="${PGHOST:-localhost}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
export PGOPTIONS='-c client_min_messages=warning'
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f packages/db/sql/seed-demo.sql
