#!/usr/bin/env bash
# Browser tests (Playwright) against production builds, in one mode. This is what CI runs, so a failure there can be
# reproduced here:
#
#   bash scripts/e2e.sh demo            # the app on its in-browser data
#   bash scripts/e2e.sh api             # the app on the real API and a freshly seeded Postgres 16 on localhost
#   bash scripts/e2e.sh api e2e/05-billing.api.spec.ts --headed     # anything after the mode goes to Playwright
#
# A browser that is already installed can be used with CHROME_PATH=/path/to/chromium; otherwise Playwright's own
# (`pnpm --filter @sabai/web exec playwright install chromium`).
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-demo}"
shift || true
case "$mode" in demo | api) ;; *) echo "usage: scripts/e2e.sh demo|api [playwright args…]" >&2; exit 2 ;; esac
export E2E_MODE="$mode"

if [ "$mode" = api ]; then
  pnpm db:reset
  pnpm db:seed
  pnpm --filter @sabai/api build
  NEXT_PUBLIC_DATA_SOURCE=api NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm --filter @sabai/web build
else
  pnpm --filter @sabai/web build
fi

pnpm --filter @sabai/web exec playwright test "$@"
