import { expect, type Locator, type Page } from "@playwright/test";

/** The till's shift chip says whether a shift is open; opens one (with the suggested float) if not. */
export async function ensureShiftOpen(page: Page): Promise<void> {
  const chip = page.getByRole("button", { name: /กะเปิดอยู่|ยังไม่เปิดกะ/ });
  await expect(chip).toBeVisible();
  // The chip is drawn before the shift has been read from the server; wait for the answer to settle.
  await page.waitForTimeout(1500);
  if (/ยังไม่เปิดกะ/.test((await chip.textContent()) ?? "")) {
    await chip.click();
    await page.getByRole("button", { name: /^เปิดกะด้วยเงินทอน/ }).click();
    await expect(page.getByText("เปิดกะแล้ว ขายได้เลย")).toBeVisible();
  }
}

export async function openPos(page: Page): Promise<void> {
  await page.goto("/pos");
  await ensureShiftOpen(page);
}

/** Puts one of an item on the bill and takes cash for it. Leaves the "paid" dialog open, for a test that wants to do something with the receipt. */
export async function payFor(page: Page, item: RegExp): Promise<{ done: Locator; receiptNo: string }> {
  await page.getByRole("button", { name: item }).first().click();
  await page.getByRole("button", { name: /^ชำระเงิน/ }).first().click();
  const pay = page.getByRole("dialog", { name: "รับชำระเงิน" });
  await expect(pay).toBeVisible();
  await pay.getByRole("button", { name: /^รับเงิน/ }).click();
  const done = page.getByRole("dialog", { name: "รับเงินเรียบร้อย" });
  await expect(done).toBeVisible();
  const receiptNo = ((await done.getByText(/ใบเสร็จ /).first().textContent()) ?? "").match(/[A-Z0-9]+-[A-Z0-9-]+/)?.[0] ?? "";
  expect(receiptNo, "the receipt number is shown").not.toBe("");
  return { done, receiptNo };
}

/** Sells one of an item for cash, closes the receipt, and returns the receipt number. */
export async function sellAndPay(page: Page, item: RegExp): Promise<string> {
  const { done, receiptNo } = await payFor(page, item);
  await done.getByRole("button", { name: "บิลถัดไป" }).click();
  return receiptNo;
}
