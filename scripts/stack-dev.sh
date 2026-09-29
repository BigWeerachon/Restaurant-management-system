#!/usr/bin/env bash
# Full local stack against real Postgres instead of the browser demo adapter:
# reset the dev database, seed the sample shop, then run the API and web app
# together. Requires Postgres 16 on localhost (see packages/db/README or
# AGENTS.md); DATABASE_URL/JWT_SECRET default to values that match db:reset,
# so no .env file is required for local dev.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm db:reset
pnpm db:seed

pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

pnpm --filter @sabai/api dev &
pids+=("$!")

# NEXT_PUBLIC_DATA_SOURCE selects the web app's DataSource adapter (ADR-0009).
# With "api" the welcome page offers "เชื่อมต่อร้านจริง" (dev login by email, e.g.
# owner@sabai.dev, then a role + PIN). Only sign-in and loading the shop are wired
# to the API so far; the other pages move over one by one (checklist phase 4).
NEXT_PUBLIC_DATA_SOURCE=api pnpm --filter @sabai/web dev &
pids+=("$!")

echo "✔ API on http://localhost:8787 · web on http://localhost:3000 (Ctrl+C stops both)"
wait
