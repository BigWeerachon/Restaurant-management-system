import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expectAccessible } from "./support/a11y";
import { payFor, openPos } from "./support/pos";
import { signIn } from "./support/session";
import { expect, test } from "./support/test";

declare global {
  interface Window {
    __prints: { html: string | null; text: string | null; pageStyle: string | null }[];
  }
}

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/** What the printer was handed, without printing: the app calls `window.print()` with a `#print-root` on the page. */
const prints = (page: Page) => page.evaluate(() => window.__prints.length);
const lastPrint = (page: Page) => page.evaluate(() => window.__prints.at(-1)!);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__prints = [];
    window.print = () =>
      void window.__prints.push({
        html: document.getElementById("print-root")?.outerHTML ?? null,
        text: document.getElementById("print-root")?.innerText ?? null,
        pageStyle: document.getElementById("receipt-page-size")?.textContent ?? null,
      });
  });
});

// The full tax invoice a customer asks for. One long story, because each part needs the one before: a shop that is not
// set up cannot issue one; once it is, mistakes are caught where they are typed; what is issued is on paper as A4, an
// original and a copy, and is remembered by the bill.
test("a customer asks for a full tax invoice: the shop must be set up, mistakes are caught, and what is issued is kept and printed", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  await test.step("the shop is VAT-registered, has no taxpayer number on file, and its branches have an address", async () => {
    await page.goto("/settings?tab=business");
    const vat = page.getByRole("switch", { name: /จดทะเบียนภาษีมูลค่าเพิ่ม/ });
    await expect(vat).toBeVisible();
    if ((await vat.getAttribute("aria-checked")) !== "true") {
      await vat.click();
      await expect(page.getByText(/เปิดคิด VAT แล้ว/).first()).toBeVisible();
    }
    await page.goto("/settings?tab=receipt");
    await expect(page.getByRole("heading", { name: "ข้อมูลบนใบเสร็จและใบกำกับภาษี" })).toBeVisible();
    await page.getByLabel(/^เลขประจำตัวผู้เสียภาษี/).fill("");
    await page.getByLabel(/^ชื่อนิติบุคคล/).fill("");
    const save = page.getByRole("button", { name: "บันทึก", exact: true });
    if (await save.isEnabled()) {
      await save.click();
      await expect(page.getByText("บันทึกข้อมูลบนใบเสร็จแล้ว").first()).toBeVisible();
    }
    await page.goto("/settings?tab=branches");
    await expect(page.locator("main article button").first()).toBeVisible();
    for (let i = 0; i < 2; i++) {
      const noAddress = page.locator("main article button", { hasText: "ยังไม่ได้ใส่ที่อยู่" }).first();
      if (!(await noAddress.count())) break;
      await noAddress.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/^ที่อยู่/).fill("12 ซ.อารีย์ แขวงสามเสนใน เขตพญาไท กรุงเทพฯ 10400");
      await dialog.getByRole("button", { name: /^บันทึก/ }).click();
      await expect(dialog).toBeHidden();
    }
  });

  await openPos(page);

  await test.step("a shop that is not set up is told what is missing, and is not offered a form", async () => {
    const { done, receiptNo } = await payFor(page, /ข้าวไข่เจียว/);
    expect(receiptNo).toMatch(/[A-Z0-9]+-\d+/);
    await done.getByRole("button", { name: /ลูกค้าขอใบกำกับภาษีเต็มรูป/ }).click();
    const tax = page.getByRole("dialog", { name: "ขอใบกำกับภาษีเต็มรูป" });
    await expect(tax).toBeVisible();
    await expect(tax.getByRole("status").first()).toBeVisible();
    await expect(tax.getByRole("button", { name: "ออกใบกำกับภาษี" })).toHaveCount(0);
    await expectAccessible(page, "tax invoice, shop not set up");
    await tax.getByRole("button", { name: "ปิด", exact: true }).last().click();
    await page.getByRole("button", { name: "บิลถัดไป" }).click();
  });

  await test.step("the shop puts its taxpayer number and name on file", async () => {
    await page.goto("/settings?tab=receipt");
    await page.getByLabel(/^เลขประจำตัวผู้เสียภาษี/).fill("1101700230708");
    await page.getByLabel(/^ชื่อนิติบุคคล/).fill("บริษัท ครัวคุณแม่ จำกัด");
    await page.getByRole("button", { name: "บันทึก", exact: true }).click();
    await expect(page.getByText("บันทึกข้อมูลบนใบเสร็จแล้ว").first()).toBeVisible();
  });

  await openPos(page);
  const { done, receiptNo } = await payFor(page, /ข้าวไข่เจียว/);
  await done.getByRole("button", { name: /ลูกค้าขอใบกำกับภาษีเต็มรูป/ }).click();
  const tax = page.getByRole("dialog", { name: "ขอใบกำกับภาษีเต็มรูป" });
  await expect(tax).toBeVisible();
  let invoiceNo = "";

  await test.step("mistakes are caught where they are typed", async () => {
    await expectAccessible(page, "tax invoice form");
    await tax.getByRole("button", { name: "ออกใบกำกับภาษี" }).click();
    await expect(tax.getByRole("alert").first()).toBeVisible();
    // A taxpayer number that does not check out (a mistyped digit) is refused before anything is written.
    await tax.getByLabel(/^เลขประจำตัวผู้เสียภาษี 13 หลัก/).fill("1101700230705");
    await tax.getByLabel(/^ชื่อผู้ซื้อ/).fill("บริษัท ผู้ซื้อ จำกัด");
    await tax.getByLabel(/^ที่อยู่ผู้ซื้อ/).fill("99 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110");
    await tax.getByRole("button", { name: "ออกใบกำกับภาษี" }).click();
    await expect(tax.getByRole("alert").filter({ hasText: /เลขประจำตัว|ตรวจ/ }).first()).toBeVisible();
    await expectAccessible(page, "tax invoice form with errors");
    await tax.getByRole("radio", { name: "สาขา" }).click();
    await tax.getByLabel(/^เลขที่สาขา/).fill("12");
    await tax.getByRole("button", { name: "ออกใบกำกับภาษี" }).click();
    await expect(tax.getByText(/ตัวเลข 5 หลัก/)).toBeVisible();
  });

  await test.step("a correct request is issued once, with a number, for the branch named", async () => {
    await tax.getByLabel(/^เลขที่สาขา/).fill("00003");
    await tax.getByLabel(/^เลขประจำตัวผู้เสียภาษี 13 หลัก/).fill("0105536001239");
    await tax.getByRole("button", { name: "ออกใบกำกับภาษี" }).click();
    const issued = page.getByRole("dialog", { name: "ใบกำกับภาษีเต็มรูป" });
    await expect(issued).toBeVisible();
    invoiceNo = (((await issued.getByText(/ออกใบกำกับภาษีแล้ว เลขที่/).textContent()) ?? "").match(/[A-Z0-9]+-TI-[0-9]+-[0-9]+/) ?? [""])[0];
    expect(invoiceNo).not.toBe("");
    await expectAccessible(page, "tax invoice issued");

    // On paper: an original for the buyer and a copy for the seller, both saying who is who and what was paid.
    const before = await prints(page);
    await issued.getByRole("button", { name: /พิมพ์ใบกำกับภาษี/ }).click();
    await expect.poll(() => prints(page)).toBe(before + 1);
    const doc = await lastPrint(page);
    expect(doc.text).toContain("ต้นฉบับ (สำหรับผู้ซื้อ)");
    expect(doc.text).toContain("สำเนา (สำหรับผู้ขาย)");
    expect(doc.text, "buyer's taxpayer number, as printed").toContain("0-1055-36001-23-9");
    expect(doc.text, "seller's taxpayer number, as printed").toContain("1-1017-00230-70-8");
    expect(doc.text).toContain("สาขาที่ 00003");
    expect(doc.text).toMatch(/บาทถ้วน/);
    expect(doc.text).toContain(invoiceNo);
    await expect(page.locator("#print-root")).toHaveCount(0);

    // What the paper gets: A4, and exactly two pages (the original and the copy).
    await page.setContent(`<!doctype html><html lang="th"><head><meta charset="utf-8"></head><body></body></html>`);
    await page.addStyleTag({ content: "/* Paper." + css.split("/* Paper.")[1] });
    await page.evaluate((html) => {
      document.body.innerHTML = html.replace('id="print-root" aria-hidden="true"', 'id="print-root"');
    }, doc.html!);
    await page.addStyleTag({ content: "@page { size: A4; margin: 12mm; }" });
    await page.emulateMedia({ media: "print" });
    const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
    expect((pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length, "an original and a copy: two pages").toBe(2);
    expect(pdf.match(/\/MediaBox\s*\[([^\]]*)\]/)?.[1]?.trim().split(/\s+/).map(Number).map(Math.round), "A4").toEqual([0, 0, 595, 842]);
    await page.emulateMedia({ media: "screen" });
  });

  await test.step("the bill remembers its invoice; the receipt points to it; a refund warns about the credit note", async () => {
    await page.goto("/orders");
    await expect(page.locator("main li button").first()).toBeVisible();
    await page.locator("main li button").first().click();
    const bill = page.getByRole("dialog", { name: /^บิล #/ });
    await expect(bill.getByText(/ออกใบกำกับภาษีเต็มรูปแล้ว เลขที่/)).toContainText(invoiceNo);
    await expect(bill).toContainText(receiptNo);
    await expectAccessible(page, "a bill with a tax invoice");

    const before = await prints(page);
    await bill.getByRole("button", { name: "พิมพ์ซ้ำ" }).click();
    await expect.poll(() => prints(page)).toBe(before + 1);
    expect((await lastPrint(page)).text, "the receipt says where the invoice is").toContain(`ออกใบกำกับภาษีเต็มรูปแล้ว เลขที่ ${invoiceNo}`);
    await expect(page.locator("#print-root")).toHaveCount(0);

    await bill.getByRole("button", { name: /ใบกำกับภาษีเต็มรูป/ }).click();
    const again = page.getByRole("dialog", { name: "ใบกำกับภาษีเต็มรูป" });
    await expect(again.getByText(/เลขที่/).first()).toContainText(invoiceNo);
    await again.getByRole("button", { name: "ปิด", exact: true }).last().click();

    await bill.getByRole("button", { name: "คืนเงิน" }).click();
    const refund = page.getByRole("dialog", { name: "คืนเงินทั้งบิล?" });
    await expect(refund.getByText(/ใบลดหนี้/).first()).toBeVisible();
    await expectAccessible(page, "refund of a bill that has a tax invoice");
    await refund.getByRole("button", { name: "ยกเลิก" }).click();
    await expect(bill).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("a bill without an invoice still offers one; a reload keeps the invoice, with the same number", async () => {
    await openPos(page);
    const second = await payFor(page, /ข้าวผัดไก่/);
    await second.done.getByRole("button", { name: "บิลถัดไป" }).click();
    await page.goto("/orders");
    await page.locator("main li button").first().click();
    let bill = page.getByRole("dialog", { name: /^บิล #/ });
    await expect(bill.getByRole("button", { name: /ใบกำกับภาษีเต็มรูป/ })).toContainText("ขอ");
    await expect(bill.getByText(/ออกใบกำกับภาษีเต็มรูปแล้ว/)).toHaveCount(0);
    await page.reload();
    await page.locator("main li button").nth(1).click();
    bill = page.getByRole("dialog", { name: /^บิล #/ });
    await bill.getByRole("button", { name: /ใบกำกับภาษีเต็มรูป/ }).click();
    await expect(page.getByRole("dialog", { name: "ใบกำกับภาษีเต็มรูป" }).getByText(new RegExp(invoiceNo))).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("on a phone the form fits the screen", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/orders");
    await page.locator("main li button").first().click();
    const bill = page.getByRole("dialog", { name: /^บิล #/ });
    await bill.getByRole("button", { name: /ขอใบกำกับภาษีเต็มรูป/ }).click();
    const phoneForm = page.getByRole("dialog", { name: "ขอใบกำกับภาษีเต็มรูป" });
    await expect(phoneForm).toBeVisible();
    await phoneForm.getByRole("radio", { name: "สาขา" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "no sideways scrolling").toBeLessThanOrEqual(0);
    await expectAccessible(page, "tax invoice form on a phone");
  });
});
