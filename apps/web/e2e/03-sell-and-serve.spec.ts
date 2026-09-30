import { expectAccessible } from "./support/a11y";
import { openPos, sellAndPay } from "./support/pos";
import { signIn } from "./support/session";
import { expect, test } from "./support/test";

test.describe("from the till to the kitchen and into the books", () => {
  test("an order sent to the kitchen is started, ticked, finished and recalled — and the server keeps it across a reload", async ({ page }) => {
    await signIn(page, "owner");
    await openPos(page);
    await page.getByRole("button", { name: /ข้าวไข่เจียว/ }).first().click();
    await page.getByRole("button", { name: /^ส่งครัว/ }).first().click();
    await expect(page.getByText("ส่งเข้าครัวแล้ว")).toBeVisible();

    await page.goto("/kds");
    // A new ticket for the dish (older ones from earlier runs may be further along; this one still has "start").
    const fresh = page.locator("article").filter({ hasText: "ข้าวไข่เจียว" }).filter({ has: page.getByRole("button", { name: /เริ่มทำ/ }) }).first();
    await expect(fresh).toBeVisible();
    const number = ((await fresh.getByText(/#\d+/).first().textContent()) ?? "").match(/#\d+/)![0];
    const mine = () => page.locator("article").filter({ hasText: number }).filter({ hasText: "ข้าวไข่เจียว" }).first();
    await expectAccessible(page, "the kitchen screen");

    await mine().getByRole("button", { name: /เริ่มทำ/ }).click();
    await expect(mine().getByRole("button", { name: /เสร็จแล้ว/ })).toBeVisible();

    const line = mine().getByRole("button", { name: /ข้าวไข่เจียว/ }).first();
    await line.click();
    await expect(line).toHaveAttribute("aria-pressed", "true");

    // Still in progress, still ticked, after a reload.
    await page.reload();
    await expect(mine().getByRole("button", { name: /เสร็จแล้ว/ })).toBeVisible();
    await expect(mine().getByRole("button", { name: /ข้าวไข่เจียว/ }).first()).toHaveAttribute("aria-pressed", "true");

    await mine().getByRole("button", { name: /เสร็จแล้ว/ }).click();
    // Finishing is not final: for a few seconds the screen offers to take the ticket back, and it comes back as it was.
    await page.getByRole("button", { name: "เรียกคืน", exact: true }).click();
    await expect(mine().getByRole("button", { name: /เสร็จแล้ว/ })).toBeVisible();
  });

  test("an item marked sold out stays sold out across a reload, and can be put back", async ({ page }) => {
    await signIn(page, "owner");
    await page.goto("/kds");
    await page.getByRole("button", { name: /ของหมด/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const item = dialog.locator("button[aria-pressed='false']").first();
    const name = ((await item.textContent()) ?? "").trim();
    await item.click();
    await expect(dialog.locator("button[aria-pressed='true']")).toHaveCount(1);

    await page.reload();
    await page.getByRole("button", { name: /ของหมด/ }).first().click();
    const again = page.getByRole("dialog").locator("button[aria-pressed='true']");
    await expect(again, `"${name}" is still out`).toHaveCount(1);
    await again.first().click();
    await expect(page.getByRole("dialog").locator("button[aria-pressed='true']")).toHaveCount(0);
  });

  test("a bill paid at the till appears among today's bills with its receipt number", async ({ page }) => {
    await signIn(page, "owner");
    await openPos(page);
    const receiptNo = await sellAndPay(page, /ข้าวผัดไก่/);
    await page.goto("/orders");
    await expect(page.locator("main li button").first()).toBeVisible();
    await page.locator("main li button").first().click();
    const bill = page.getByRole("dialog", { name: /^บิล #/ });
    await expect(bill).toBeVisible();
    await expect(bill, "the newest bill is the one just paid").toContainText(receiptNo);
    await expectAccessible(page, "a paid bill");
  });
});
