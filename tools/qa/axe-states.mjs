import { chromium } from "playwright-core";
import { AxeBuilder } from "@axe-core/playwright";
const base = process.env.BASE ?? "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const out = [];
async function audit(page, name) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  out.push(`${name.padEnd(34)} violations=${r.violations.length}` + r.violations.map((v) => `\n   - [${v.impact}] ${v.id} ×${v.nodes.length} ${v.nodes[0]?.target.join(" ")} :: ${(v.nodes[0]?.failureSummary ?? "").split("\n")[1] ?? ""}`).join(""));
}
async function session(role, w, h, theme = "light") {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, locale: "th-TH", timezoneId: "Asia/Bangkok", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(role) }).first().click();
  await page.waitForTimeout(1200);
  return page;
}
// Cashier: modifier sheet, payment dialog, receipt
{
  const page = await session("แคชเชียร์", 1366, 900);
  await page.waitForURL("**/pos");
  await page.getByRole("radio", { name: /กลับบ้าน/ }).click();
  await page.getByRole("button", { name: /ข้าวกะเพราไก่/ }).first().click();
  await page.getByRole("button", { name: /ลาเต้เย็น/ }).first().click();
  await page.waitForTimeout(500);
  await audit(page, "POS · modifier sheet");
  await page.getByRole("radio", { name: /หวานน้อย/ }).click();
  await page.getByRole("button", { name: /เพิ่มลงบิล/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^ชำระเงิน$/ }).click();
  await page.waitForTimeout(600);
  await audit(page, "POS · payment dialog");
  await page.getByRole("button", { name: /รับเงิน/ }).click();
  await page.waitForTimeout(900);
  await audit(page, "POS · paid / receipt");
}
// Owner: command palette, add-staff wizard, switch user (PIN), report table view
{
  const page = await session("เจ้าของ", 1280, 860);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(400);
  await audit(page, "Command palette");
  await page.keyboard.press("Escape");
  await page.goto(base + "/team", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "เพิ่มพนักงาน" }).first().click();
  await page.waitForTimeout(400);
  await audit(page, "Team · add staff step 1");
  await page.locator("#nm").fill("น้องมายด์");
  await page.getByRole("button", { name: "ต่อไป" }).click();
  await page.waitForTimeout(300);
  await audit(page, "Team · add staff step 2");
  await page.keyboard.press("Escape");
  await page.goto(base + "/reports", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "ดูเป็นตาราง" }).first().click();
  await page.waitForTimeout(400);
  await audit(page, "Reports · table view");
}
// Mobile (phone) + dark
for (const [role, url] of [["เจ้าของ", "/today"], ["เจ้าของ", "/reports"], ["แคชเชียร์", "/pos"], ["ครัว", "/kds"], ["สต็อก", "/inventory"]]) {
  const page = await session(role, 390, 844, "dark");
  await page.goto(base + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await audit(page, `Phone dark · ${url}`);
  await page.context().close();
}
console.log(out.join("\n"));
await browser.close();
