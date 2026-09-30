// Lighthouse on signed-in pages: Chromium with a debugging port, sign in via CDP,
// then audit with storage kept (the demo session lives in localStorage).
import { chromium } from "playwright-core";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { rmSync, writeFileSync } from "node:fs";
const base = process.env.BASE ?? "http://localhost:3100";
const form = process.env.FORM ?? "mobile";
const port = 9333 + (form === "desktop" ? 1 : 0);
// The budget: what a page may not fall below (scores, 0–100) or above (the metrics). On a quiet machine the scores are
// 93–100 and LCP ≤ 1.4 s, but total blocking time swings by half between identical runs on a busy one (a shared CI
// runner), so the budget is there to catch a real regression, not to police noise; a route that misses it is measured
// again (ATTEMPTS, default 3) and its best run counts. Anything can be overridden, e.g. BUDGET_PERF=90.
const num = (name, fallback) => (process.env[name] !== undefined ? Number(process.env[name]) : fallback);
const budget =
  form === "desktop"
    ? { perf: num("BUDGET_PERF", 85), a11y: num("BUDGET_A11Y", 100), bp: num("BUDGET_BP", 95), seo: num("BUDGET_SEO", 95), lcpMs: num("BUDGET_LCP_MS", 2500), cls: num("BUDGET_CLS", 0.1), tbtMs: num("BUDGET_TBT_MS", 400) }
    : { perf: num("BUDGET_PERF", 70), a11y: num("BUDGET_A11Y", 100), bp: num("BUDGET_BP", 95), seo: num("BUDGET_SEO", 95), lcpMs: num("BUDGET_LCP_MS", 3500), cls: num("BUDGET_CLS", 0.1), tbtMs: num("BUDGET_TBT_MS", 1000) };
// A fresh browser profile every time: one left over from an earlier run is already signed in (or holds an old service worker),
// and the sign-in below would wait for a screen that is not there.
const profile = tmpdir() + "/sabai-lh-" + form;
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(process.env.CHROME_PATH ?? "chromium", [`--remote-debugging-port=${port}`, "--headless=new", "--no-sandbox", "--disable-gpu", "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
// Whatever happens below, the browser goes with the script: one left behind keeps the debugging port, and the next run talks to it.
process.on("exit", () => chrome.kill());
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].newPage());
await page.goto(base + "/", { waitUntil: "networkidle" });
if (process.env.MODE === "api") {
  // The app connected to the API (a build with NEXT_PUBLIC_DATA_SOURCE=api, the API and a seeded database running):
  // connect with the seeded account, pick the owner's card, enter the PIN — as a person would.
  await page.getByLabel("อีเมล").fill(process.env.EMAIL ?? "owner@sabai.dev");
  await page.getByRole("button", { name: /เชื่อมต่อ/ }).click();
  await page.getByText("เชื่อมต่อกับระบบจริงแล้ว").waitFor();
  await page.getByRole("button", { name: /คุณปิยะ/ }).filter({ hasNotText: /เข้าเป็น/ }).first().click();
  for (const d of process.env.PIN ?? "1234") await page.getByRole("dialog").getByRole("button", { name: new RegExp(`^${d}$`) }).first().click();
} else {
  await page.getByRole("button", { name: /เจ้าของ/ }).first().click();
}
await page.waitForTimeout(1500);
const routes = (process.env.ROUTES ?? "/,/today,/reports,/pos,/kds,/inventory,/menu,/finance").split(",");
const rows = [];
const attempts = num("ATTEMPTS", 3);
const config = form === "desktop"
  ? { ...desktopConfig, settings: { ...desktopConfig.settings, disableStorageReset: true } }
  : { extends: "lighthouse:default", settings: { disableStorageReset: true } };

async function measure(r) {
  const res = await lighthouse(base + r, { port, output: "json", logLevel: "error", disableStorageReset: true }, config);
  const c = res.lhr.categories;
  const a = res.lhr.audits;
  const row = { route: r, perf: Math.round(c.performance.score * 100), a11y: Math.round(c.accessibility.score * 100), bp: Math.round(c["best-practices"].score * 100), seo: Math.round(c.seo.score * 100), lcp: a["largest-contentful-paint"].displayValue, cls: a["cumulative-layout-shift"].displayValue, tbt: a["total-blocking-time"].displayValue, finalUrl: res.lhr.finalDisplayedUrl, lcpMs: Math.round(a["largest-contentful-paint"].numericValue), clsValue: a["cumulative-layout-shift"].numericValue, tbtMs: Math.round(a["total-blocking-time"].numericValue) };
  const fails = Object.values(a).filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode === "binary").map((x) => x.id);
  if (fails.length) row.fails = fails.join(",");
  return row;
}
const problemsOf = (row) => {
  const out = [];
  if (new URL(row.finalUrl).pathname !== new URL(base + row.route).pathname) out.push(`${row.route}: ended up on ${new URL(row.finalUrl).pathname}`);
  for (const [key, min] of [["perf", budget.perf], ["a11y", budget.a11y], ["bp", budget.bp], ["seo", budget.seo]]) if (row[key] < min) out.push(`${row.route}: ${key} ${row[key]} < ${min}`);
  if (row.lcpMs > budget.lcpMs) out.push(`${row.route}: LCP ${row.lcpMs} ms > ${budget.lcpMs} ms`);
  if (row.clsValue > budget.cls) out.push(`${row.route}: CLS ${row.clsValue} > ${budget.cls}`);
  if (row.tbtMs > budget.tbtMs) out.push(`${row.route}: TBT ${row.tbtMs} ms > ${budget.tbtMs} ms`);
  return out;
};
for (const r of routes) {
  let best = await measure(r);
  for (let n = 1; n < attempts && problemsOf(best).length; n++) {
    const again = await measure(r);
    if (again.perf > best.perf) best = again;
  }
  rows.push(best);
}
console.table(rows.map(({ lcpMs, clsValue, tbtMs, ...shown }) => shown));
writeFileSync(`lh-${process.env.MODE === "api" ? "api-" : ""}${form}.json`, JSON.stringify(rows, null, 2));
await browser.close();
chrome.kill();

// Held to the budget. A page that redirected to the welcome screen (the sign-in did not work) is a failure too: it
// would otherwise pass with the welcome screen's good numbers.
const broken = rows.flatMap(problemsOf);
if (broken.length) {
  console.error(`\nOVER BUDGET (${form}):\n  ${broken.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nWithin budget (${form}): ${JSON.stringify(budget)}`);
