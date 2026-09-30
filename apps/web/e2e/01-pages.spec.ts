import type { Page } from "@playwright/test";
import { expectAccessible } from "./support/a11y";
import { BACK_OFFICE_ROUTES } from "./support/routes";
import { signIn, settled } from "./support/session";
import { expect, test } from "./support/test";

// Every page, as the owner, in both colour schemes: it opens (not the "page broke" screen), it has something on it,
// nothing throws or fails in the background (see support/test.ts), and WCAG 2.2 AA has nothing to say.
for (const theme of ["light", "dark"] as const) {
  test.describe(`every back-office page, ${theme}`, () => {
    test.use({ colorScheme: theme });

    for (const route of BACK_OFFICE_ROUTES) {
      test(`${route}`, async ({ page }) => {
        await signIn(page, "owner");
        await page.goto(route);
        await settled(page);
        await expect(page.getByRole("heading", { name: /ขัดข้องชั่วคราว/ })).toHaveCount(0);
        await expect(page.locator("main").first()).toBeVisible();
        await expectAccessible(page, `${route} (${theme})`);
      });
    }
  });
}

// A phone, in the dark — the way it is really held (touch, mobile viewport): every page the owner can open, and each
// role's own screen. None may scroll sideways (a page wider than the phone is a page that is hard to use one-handed).
test.describe("on a phone, dark", () => {
  test.use({ colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  async function expectFits(page: Page, label: string) {
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      if (doc.scrollWidth <= doc.clientWidth) return null;
      // Name what sticks out, so the failure says where to look.
      const wide = [...document.querySelectorAll("body *")]
        .filter((e) => e.getBoundingClientRect().right > doc.clientWidth + 1 && ![...e.children].some((c) => c.getBoundingClientRect().right > doc.clientWidth + 1))
        .slice(0, 4)
        .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 50)} "${(e.textContent ?? "").trim().slice(0, 30)}"`);
      return `${doc.scrollWidth}px wide on a ${doc.clientWidth}px phone: ${wide.join(" | ")}`;
    });
    expect(overflow, `${label}: no sideways scrolling`).toBeNull();
  }

  for (const route of BACK_OFFICE_ROUTES) {
    test(`owner on ${route}`, async ({ page }) => {
      await signIn(page, "owner");
      await page.goto(route);
      await settled(page);
      await expect(page.getByRole("heading", { name: /ขัดข้องชั่วคราว/ })).toHaveCount(0);
      await expect(page.locator("main").first()).toBeVisible();
      await expectFits(page, route);
      await expectAccessible(page, `${route} on a phone (dark)`);
    });
  }

  for (const [who, route] of [
    ["cashier", "/pos"],
    ["kitchen", "/kds"],
  ] as const) {
    test(`${who} on ${route}`, async ({ page }) => {
      await signIn(page, who);
      await settled(page);
      await expect(page.locator("main").first()).toBeVisible();
      await expectFits(page, route);
      await expectAccessible(page, `${who} on ${route}, on a phone (dark)`);
    });
  }
});
