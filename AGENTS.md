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
| Full local stack on Postgres | `pnpm stack:dev` (reset DB, seed, API + web in API mode) |
| Lighthouse budget | see `tools/qa/README.md` (CI runs it too) — also how to chase a score that dropped |

## Rules that tests enforce

- Business rules live in Postgres commands (`supabase/migrations`) and pure TS (`packages/domain`); the API and UI are thin.
  When a formula exists in both (pricing, costing, expense allocation, reconciliation, billing stage), change both and keep the parity tests green.
- Every table has `tenant_id`, RLS via `app.apply_tenant_rls`, and composite FKs `(tenant_id, id)`.
- Ledgers (`stock_movements`, `payments`, `journal_lines`, `audit.log`) are append-only — correct with reversals.
- Money is integer satang in TS, `numeric` in SQL, decimal strings in the API. Never floats.
- Every registered API route is listed in `docs/06-api.md` with the right count (`apps/api/test/docs.test.ts`).
- Permission keys live in `packages/domain/src/permissions.ts` and are seeded in `…_bootstrap.sql`; an API test fails if they drift. Plans mirror `app.plans` (drift test in `packages/domain/test/plans.test.ts`).
- New user-facing errors go in `ERROR_CATALOG` (Thai + English, with an action). Never show SQL or stack traces to users.
- UI: semantic tokens only (`apps/web/src/app/globals.css`), targets ≥ 44px, status colour always with icon + words,
  accessible names must contain the visible text (Thai has no word spaces — prefer visible/`sr-only` text over `aria-label`).
  New pages need empty/loading/error states, phone layout, dark mode, and 0 axe violations.
- The first screen on a phone stays light (`docs/04-architecture.md` §5e): code only one mode uses (HTTP adapter, live line, offline queue,
  sign-in panels, printing) is a separate download; no `Intl.*Format` built per call; no size read in a layout effect on first paint;
  images are given the size they are drawn at. The browser tests draw the whole page before scanning (`.offscreen-lazy`).
- `apps/web` uses Next.js 16 — read `apps/web/AGENTS.md` and the bundled docs in `node_modules/next/dist/docs` before using Next APIs.

## Current state

Every page goes through one `DataSource` (ADR-0009): `NEXT_PUBLIC_DATA_SOURCE=demo` (the default — an in-browser engine in
`apps/web/src/lib/demo` that mirrors the database commands; what Vercel serves) or `api` (the Hono API on Postgres, with live
events, an offline queue, sign-in, registered tills, printing, tax invoices and the shop's own billing).
V1.1 is done except what needs the owner's accounts: Supabase Auth, a card/PromptPay provider, a place to deploy the API
(`docs/v1.1-checklist.md`, `docs/08-scorecard.md` §5).
