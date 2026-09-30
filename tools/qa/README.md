# QA audits

CI runs these on every push (`.github/workflows/ci.yml`):

- **Browser tests + accessibility** — `apps/web/e2e` (Playwright, run with `pnpm e2e demo|api` from the repo root).
  Every back-office page in light and dark and on a phone is opened, must not throw or fail in the background, must not
  scroll sideways on a phone, and must have **zero WCAG 2.2 AA violations** (axe); dialogs and wizards too.
- **Lighthouse budget** — `lighthouse.mjs` below, against a production build.

`axe-pages.mjs` and `axe-states.mjs` are the older stand-alone versions of the accessibility checks (still handy for a
quick look at one running build); the Playwright specs are the ones that gate CI.

## Lighthouse

Run against a production build of the web app:

```bash
pnpm --filter @sabai/web build && pnpm --filter @sabai/web exec next start -p 3100
cd tools/qa && npm ci
CHROME_PATH=/path/to/chromium npm run lighthouse   # mobile + desktop, signed-in pages, held to the budget
```

The script signs in through the welcome screen over CDP and keeps storage between audits (`disableStorageReset`), so
signed-in pages are measured rather than the redirect to the welcome screen (a page that ends up somewhere else fails).
It exits non-zero when a page is over budget:

| | Desktop | Mobile |
|---|---:|---:|
| Accessibility | 100 | 100 |
| Best practices, SEO | ≥ 95 | ≥ 95 |
| Performance | ≥ 85 | ≥ 70 |
| LCP | ≤ 2.5 s | ≤ 3.5 s |
| CLS | ≤ 0.1 | ≤ 0.1 |
| Total blocking time | ≤ 400 ms | ≤ 1000 ms |

On a quiet machine the scores are 93–100 (see [`docs/08-scorecard.md`](../../docs/08-scorecard.md)); total blocking time
swings by half between identical runs on a busy one, so the budget is there to catch a real regression, not noise, and a
route that misses it is measured again (`ATTEMPTS`, default 3) with its best run counting. Every number can be
overridden: `BUDGET_PERF`, `BUDGET_A11Y`, `BUDGET_BP`, `BUDGET_SEO`, `BUDGET_LCP_MS`, `BUDGET_CLS`, `BUDGET_TBT_MS`.
Raw results are written to `lh-mobile.json` / `lh-desktop.json`; the ones used in the scorecard are kept in
[`docs/qa`](../../docs/qa).
