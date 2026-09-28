# QA audits

Run against a production build of the web app:

```bash
pnpm --filter @sabai/web build && pnpm --filter @sabai/web exec next start -p 3100
cd tools/qa && npm install
CHROME_PATH=/path/to/chromium npm run axe         # WCAG 2.2 AA, light + dark + dialogs + phone
CHROME_PATH=/path/to/chromium npm run lighthouse  # mobile + desktop, signed-in pages
```

The Lighthouse script signs in through the welcome screen over CDP and keeps
storage between audits (`disableStorageReset`), so signed-in pages are measured
rather than the redirect to the welcome screen. Results used in the scorecard:
[`docs/08-scorecard.md`](../../docs/08-scorecard.md).
