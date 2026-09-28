// Lighthouse on signed-in pages: Chromium with a debugging port, sign in via CDP,
// then audit with storage kept (the demo session lives in localStorage).
import { chromium } from "playwright-core";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
const base = process.env.BASE ?? "http://localhost:3100";
const form = process.env.FORM ?? "mobile";
const port = 9333 + (form === "desktop" ? 1 : 0);
const chrome = spawn(process.env.CHROME_PATH ?? "chromium", [`--remote-debugging-port=${port}`, "--headless=new", "--no-sandbox", "--disable-gpu", "--user-data-dir=" + tmpdir() + "/sabai-lh-" + form, "about:blank"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].newPage());
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /เจ้าของ/ }).first().click();
await page.waitForTimeout(1500);
const routes = (process.env.ROUTES ?? "/,/today,/reports,/pos,/kds,/inventory,/menu,/finance").split(",");
const rows = [];
for (const r of routes) {
  const config = form === "desktop"
    ? { ...desktopConfig, settings: { ...desktopConfig.settings, disableStorageReset: true } }
    : { extends: "lighthouse:default", settings: { disableStorageReset: true } };
  const res = await lighthouse(base + r, { port, output: "json", logLevel: "error", disableStorageReset: true }, config);
  const c = res.lhr.categories;
  const a = res.lhr.audits;
  rows.push({ route: r, perf: Math.round(c.performance.score * 100), a11y: Math.round(c.accessibility.score * 100), bp: Math.round(c["best-practices"].score * 100), seo: Math.round(c.seo.score * 100), lcp: a["largest-contentful-paint"].displayValue, cls: a["cumulative-layout-shift"].displayValue, tbt: a["total-blocking-time"].displayValue, finalUrl: res.lhr.finalDisplayedUrl });
  const fails = Object.values(a).filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode === "binary").map((x) => x.id);
  if (fails.length) rows[rows.length - 1].fails = fails.join(",");
}
console.table(rows);
writeFileSync(`lh-${form}.json`, JSON.stringify(rows, null, 2));
await browser.close();
chrome.kill();
