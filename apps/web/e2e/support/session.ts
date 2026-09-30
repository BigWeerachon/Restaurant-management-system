import { expect, type Locator, type Page } from "@playwright/test";
import { IS_API } from "./env";

export type Who = "owner" | "manager" | "cashier" | "kitchen";

// The people on the welcome screen's role cards (by name — a role's description mentions other roles' words, so "ครัว"
// alone would pick the cashier, who "sends to the kitchen"), and the PINs of the seeded shop (packages/db/sql/seed-demo.sql).
const WHO: Record<Who, { name: RegExp; pin: string; home: RegExp }> = {
  owner: { name: /คุณปิยะ/, pin: "1234", home: /\/today/ },
  manager: { name: /พี่นิด/, pin: "2222", home: /\/today/ },
  cashier: { name: /น้องแพรว/, pin: "3333", home: /\/pos/ },
  kitchen: { name: /ป้าแดง/, pin: "5555", home: /\/kds/ },
};

export async function keypad(scope: Locator, digits: string): Promise<void> {
  for (const d of digits) await scope.getByRole("button", { name: new RegExp(`^${d}$`) }).first().click();
}

/** From the welcome screen to the person's home page. Demo: pick a role. API: connect with the seeded account, pick a role, enter the PIN. */
export async function signIn(page: Page, who: Who = "owner"): Promise<void> {
  const w = WHO[who];
  await page.goto("/");
  if (IS_API) {
    await page.getByLabel("อีเมล").fill("owner@sabai.dev");
    await page.getByRole("button", { name: /เชื่อมต่อ/ }).click();
    await expect(page.getByText("เชื่อมต่อกับระบบจริงแล้ว")).toBeVisible();
    // (The account's owner also has a direct "เข้าเป็น …" button that needs no PIN; the role cards are what the staff use.)
    await page.getByRole("button", { name: w.name }).filter({ hasNotText: /เข้าเป็น/ }).first().click();
    await keypad(page.getByRole("dialog"), w.pin);
  } else {
    await page.getByRole("button", { name: w.name }).first().click();
  }
  // `commit`: the move to the home page is made by the app itself, and waiting for a `load` event that never comes is a hang.
  await page.waitForURL(w.home, { timeout: 30_000, waitUntil: "commit" });
  // The page itself, not the loading screen that comes first: the first screen is drawn in slices, a moment after the URL changes
  // (and the welcome page has no <main>, so this cannot be satisfied by the screen being left).
  await expect(page.locator("main").first()).toBeVisible({ timeout: 30_000 });
}

/**
 * A page whose data has arrived: its frame is drawn and no "loading the latest" banner is showing. (Not "network idle":
 * in API mode the live event stream keeps a connection open for as long as the page is, so the network is never idle.)
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.getByText("กำลังโหลดข้อมูลล่าสุด…")).toHaveCount(0);
  // The first paint of the data, and the animations that come with it.
  await page.waitForTimeout(500);
}
