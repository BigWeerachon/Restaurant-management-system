import { chromium } from "playwright-core";
import { AxeBuilder } from "@axe-core/playwright";
const base = process.env.BASE ?? "http://localhost:3100";
const theme = process.env.THEME ?? "light";
const routes = ["/today", "/pos", "/kds", "/orders", "/inventory", "/inventory/receive", "/inventory/waste", "/inventory/count", "/inventory/new", "/menu", "/menu/new", "/purchasing", "/finance", "/finance/close", "/reports", "/team", "/settings", "/setup", "/setup/branch", "/setup/payments"];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: theme, locale: "th-TH", timezoneId: "Asia/Bangkok", reducedMotion: "reduce" });
const page = await ctx.newPage();
const results = [];
async function audit(name) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  results.push({ name, violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 2).map((x) => x.target.join(" ") + " :: " + (x.failureSummary ?? "").split("\n").slice(1, 2).join(" ")) })), passes: r.passes.length });
}
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await audit("/ (welcome)");
await page.getByRole("button", { name: /เจ้าของ/ }).first().click();
await page.waitForTimeout(1200);
for (const r of routes) {
  await page.goto(base + r, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await audit(r);
}
let total = 0;
for (const r of results) {
  total += r.violations.reduce((s, v) => s + v.n, 0);
  console.log(`${r.name.padEnd(22)} passes=${r.passes} violations=${r.violations.length}`);
  for (const v of r.violations) console.log(`   - [${v.impact}] ${v.id} ×${v.n}\n       ${v.sample.join("\n       ")}`);
}
console.log("TOTAL violating nodes:", total);
await browser.close();
