# Working in this repository

Sabai is a restaurant & café management SaaS (Thai-first). Read `docs/00-master-dev-prompt.md` before changing behaviour.

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` (Node 22+, pnpm 10) |
| Typecheck all | `pnpm typecheck` |
| Unit/integration tests | `pnpm test` (API tests need Postgres 16 on localhost) |
| Database tests | `pnpm db:test` — rebuilds `sabai_test` from `supabase/migrations` and runs `packages/db/tests/*.sql` |
| Web dev | `pnpm --filter @sabai/web dev` (demo data, no server needed) |
| API dev | `pnpm --filter @sabai/api dev` |
| Browser tests (Playwright) | `pnpm e2e demo` or `pnpm e2e api` — builds, starts what it needs, runs `apps/web/e2e`; this is what CI runs. `api` needs Postgres 16 on localhost. `CHROME_PATH=…` reuses an installed Chromium |
| Lighthouse budget | see `tools/qa/README.md` (CI runs it too) |

## Rules that tests enforce

- Business rules live in Postgres commands (`supabase/migrations`) and pure TS (`packages/domain`); the API and UI are thin.
  When a formula exists in both (pricing, costing, expense allocation, reconciliation, billing stage), change both and keep the parity tests green.
- Every table has `tenant_id`, RLS via `app.apply_tenant_rls`, and composite FKs `(tenant_id, id)`.
- Ledgers (`stock_movements`, `payments`, `journal_lines`, `audit.log`) are append-only — correct with reversals.
- Money is integer satang in TS, `numeric` in SQL, decimal strings in the API. Never floats.
- Permission keys live in `packages/domain/src/permissions.ts` and are seeded in `…_bootstrap.sql`; an API test fails if they drift. Plans mirror `app.plans` (drift test in `packages/domain/test/plans.test.ts`).
- New user-facing errors go in `ERROR_CATALOG` (Thai + English, with an action). Never show SQL or stack traces to users.
- UI: semantic tokens only (`apps/web/src/app/globals.css`), targets ≥ 44px, status colour always with icon + words,
  accessible names must contain the visible text (Thai has no word spaces — prefer visible/`sr-only` text over `aria-label`).
  New pages need empty/loading/error states, phone layout, dark mode, and 0 axe violations.
- `apps/web` uses Next.js 16 — read `apps/web/AGENTS.md` and the bundled docs in `node_modules/next/dist/docs` before using Next APIs.

## Current state

The web app runs on an in-browser demo adapter (`apps/web/src/lib/demo`) that mirrors the database commands.
Wiring it to the API through a `DataSource` interface is the next milestone (docs/07-roadmap.md, ADR-0007).
