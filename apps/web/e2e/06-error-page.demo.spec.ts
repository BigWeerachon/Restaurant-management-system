import { expectAccessible } from "./support/a11y";
import { signIn } from "./support/session";
import { expect, test } from "./support/test";

// A page that breaks shows what happened in plain Thai and one way forward — never "Application error" or a stack trace.
// (Demo mode only: it breaks a page by damaging the demo's saved data, which the API mode does not keep.)
for (const theme of ["light", "dark"] as const) {
  test.describe(`when a page breaks, ${theme}`, () => {
    test.use({ colorScheme: theme });

    test("says so in Thai, gives a reference and a way forward, and leaks nothing", async ({ page, watch }) => {
      // The break is an error thrown while drawing the page; the browser logs it, and the app catches it.
      watch.allow(/page error|console error/);
      await signIn(page, "owner");
      await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem("sabai-demo")!);
        raw.state.db.orders = null; // saved data that is not what the page expects
        localStorage.setItem("sabai-demo", JSON.stringify(raw));
      });
      await page.goto("/orders?secret=abc123&pin=1234");
      await expect(page.getByRole("heading", { name: "หน้านี้ขัดข้องชั่วคราว" })).toBeVisible();
      const text = await page.locator("body").innerText();
      expect(text).toMatch(/รหัสอ้างอิง [0-9A-F]{4}-[0-9A-F]{4}/);
      expect(text).not.toMatch(/TypeError|Cannot read|Application error|\bat \w+ \(/i);
      await expect(page.getByRole("button", { name: "ลองอีกครั้ง" })).toBeVisible();
      await expectAccessible(page, `the error page (${theme})`);

      await page.getByRole("link", { name: "กลับหน้าแรก" }).click();
      await expect(page.getByRole("button", { name: /คุณปิยะ/ }).first()).toBeVisible();
    });
  });
}
