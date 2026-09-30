import { expectAccessible } from "./support/a11y";
import { signIn } from "./support/session";
import { expect, test } from "./support/test";

// Screens that only exist for a moment — a sheet, a dialog, a wizard step — are checked too, in both colour schemes.
// (Demo mode: they use the demo menu's items by name.)
for (const theme of ["light", "dark"] as const) {
  test.describe(`moments in the day, ${theme}`, () => {
    test.use({ colorScheme: theme });

    test("the till: choosing options, taking payment, the receipt", async ({ page }) => {
      await signIn(page, "cashier");
      await page.getByRole("radio", { name: /กลับบ้าน/ }).click();
      await page.getByRole("button", { name: /ข้าวกะเพราไก่/ }).first().click();
      await page.getByRole("button", { name: /ลาเต้เย็น/ }).first().click();
      await expect(page.getByRole("radio", { name: /หวานน้อย/ })).toBeVisible();
      await expectAccessible(page, `the options sheet (${theme})`);
      await page.getByRole("radio", { name: /หวานน้อย/ }).click();
      await page.getByRole("button", { name: /เพิ่มลงบิล/ }).click();
      await page.getByRole("button", { name: /^ชำระเงิน$/ }).click();
      await expect(page.getByRole("dialog", { name: "รับชำระเงิน" })).toBeVisible();
      await expectAccessible(page, `taking payment (${theme})`);
      await page.getByRole("button", { name: /รับเงิน/ }).click();
      await expect(page.getByRole("dialog", { name: "รับเงินเรียบร้อย" })).toBeVisible();
      await expectAccessible(page, `paid, with the receipt (${theme})`);
    });

    test("the owner: search everything, add a person, read a report as a table", async ({ page }) => {
      await signIn(page, "owner");
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectAccessible(page, `the command palette (${theme})`);
      await page.keyboard.press("Escape");

      await page.goto("/team");
      await page.getByRole("button", { name: "เพิ่มพนักงาน" }).first().click();
      await expect(page.locator("#nm")).toBeVisible();
      await expectAccessible(page, `adding a person, step 1 (${theme})`);
      await page.locator("#nm").fill("น้องมายด์");
      await page.getByRole("button", { name: "ต่อไป" }).click();
      await expectAccessible(page, `adding a person, step 2 (${theme})`);
      await page.keyboard.press("Escape");

      await page.goto("/reports");
      await page.getByRole("button", { name: "ดูเป็นตาราง" }).first().click();
      await expectAccessible(page, `a report as a table (${theme})`);
    });
  });
}
