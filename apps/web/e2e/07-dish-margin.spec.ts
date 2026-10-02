import { signIn } from "./support/session";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";

/** "เหลือ ฿45.42" on the dish screen's row for a channel, in satang. */
async function keptOnChannel(page: Page, channel: string): Promise<number> {
  const row = page.locator("li").filter({ hasText: channel }).filter({ hasText: /เหลือ/ }).first();
  await expect(row).toBeVisible();
  const text = (await row.innerText()).replace(/\s+/g, " ");
  const kept = text.match(/เหลือ\s*(-?)฿([\d,]+\.\d{2})/);
  expect(kept, `the amount kept in "${text}"`).not.toBeNull();
  return (kept![1] === "-" ? -1 : 1) * Math.round(Number(kept![2]!.replace(/,/g, "")) * 100);
}

async function openDish(page: Page, name: RegExp) {
  await page.goto("/menu");
  await page.getByRole("link", { name }).first().click();
  await expect(page.getByText("เหลือจริงต่อจาน แยกตามช่องทาง")).toBeVisible();
}

async function setPricesIncludeVat(page: Page, includeVat: boolean) {
  await page.goto("/settings");
  await page.getByRole("radio", { name: includeVat ? "รวม VAT แล้ว (แนะนำ)" : "ยังไม่รวม VAT" }).click();
  await expect(page.getByRole("radio", { name: includeVat ? "รวม VAT แล้ว (แนะนำ)" : "ยังไม่รวม VAT" })).toBeChecked();
  // Saved: reading the page again shows it.
  await page.reload();
  await expect(page.getByRole("radio", { name: includeVat ? "รวม VAT แล้ว (แนะนำ)" : "ยังไม่รวม VAT" })).toBeChecked();
}

test.describe("what a portion leaves the shop, on the dish screen", () => {
  test("takes the VAT out of a price that includes it, and none out of a price that leaves it out", async ({ page }) => {
    await signIn(page, "owner");
    try {
      await setPricesIncludeVat(page, true);
      await openDish(page, /ลาเต้เย็น/);
      const withVatInside = await keptOnChannel(page, "ทานที่ร้าน");

      await setPricesIncludeVat(page, false);
      await openDish(page, /ลาเต้เย็น/);
      const withVatOnTop = await keptOnChannel(page, "ทานที่ร้าน");

      // The latte is ฿70 on the shop's own menu. With the VAT inside the price, ฿4.58 of it (70 × 7/107) belongs to the state;
      // with the VAT on top, the shop keeps the whole ฿70. The dish screen used to take the ฿4.58 off in both cases.
      expect(withVatOnTop - withVatInside).toBe(458);
    } finally {
      await setPricesIncludeVat(page, true);
    }
  });
});
