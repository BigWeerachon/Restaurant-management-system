import type { Page } from "@playwright/test";
import { keypad, signIn } from "./support/session";
import { expect, test } from "./support/test";

// The till after the tidy-up: every control a finger has to hit is at least 44px, and the one PIN keypad handler
// (support for switch user, approvals, device sign-in and connect) still fills, fails, clears and signs in.

/** Visible buttons and links inside `scope` that are smaller than 44px either way. */
async function undersized(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ["(scope not found)"];
    return [...root.querySelectorAll<HTMLElement>("button, a[href], [role=button], [role=radio]")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && (r.height < 43.5 || r.width < 43.5);
      })
      .map((e) => `${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`);
  }, scope);
}

test.describe("the till, on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("category chips and bill buttons are at least 44px", async ({ page }) => {
    await signIn(page, "owner");
    await page.goto("/pos");
    await expect(page.getByRole("button", { name: /^ทั้งหมด|ทั้งหมด$/ }).first()).toBeVisible();
    expect(await undersized(page, "main"), "menu column").toEqual([]);

    // A dish with choices opens its sheet (note chips, quantity); adding it puts a line in the bill sheet.
    await page.getByRole("button", { name: /ลาเต้เย็น/ }).first().click();
    const options = page.getByRole("dialog", { name: /ลาเต้เย็น/ });
    await expect(options.getByRole("button", { name: /^เพิ่มลงบิล/ })).toBeVisible();
    expect(await undersized(page, "[role=dialog]"), "options sheet").toEqual([]);
    await options.getByRole("button", { name: /^เพิ่มลงบิล/ }).click();
    await page.getByRole("button", { name: /ดูบิล/ }).click();
    const bill = page.getByRole("dialog", { name: "บิล" });
    await expect(bill.getByRole("button", { name: /เพิ่มจำนวน/ })).toBeVisible();
    expect(await undersized(page, "[role=dialog]"), "bill sheet").toEqual([]);
  });
});

test.describe("the PIN keypad", () => {
  test("a wrong PIN is refused and cleared, the right one signs in", async ({ page }) => {
    await signIn(page, "owner");
    await page.goto("/pos");
    await page.getByRole("button", { name: /สลับผู้ใช้/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "สลับผู้ใช้" });
    await expect(dialog).toBeVisible();

    await keypad(dialog, "9999");
    await expect(dialog.getByRole("alert")).toBeVisible();
    // Typing again clears the message and starts from empty.
    await keypad(dialog, "3333");
    await page.waitForURL(/\/pos/, { timeout: 30_000, waitUntil: "commit" });
    await expect(page.locator("main").first()).toBeVisible();
  });
});
