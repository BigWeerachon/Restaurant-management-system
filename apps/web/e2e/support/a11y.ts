import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** WCAG 2.2 AA on what is on screen right now: zero violations, and if there are some, which and where. */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  // Parts of a long page that are far below the screen are not drawn until they come near it (`.offscreen-lazy`), and a
  // part that is not drawn cannot be measured for contrast. The whole page is checked, so draw all of it for the scan.
  await page.addStyleTag({ content: "*, *::before, *::after { content-visibility: visible !important; }" });
  // A dialog that is still fading in is measured half transparent, and its text fails contrast for a moment that nobody sees.
  // (Only animations that end: a late kitchen ticket pulses for as long as it is late, and never "finishes".)
  await page.evaluate(() => {
    const ending = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime as number));
    return Promise.race([Promise.allSettled(ending.map((a) => a.finished)), new Promise((resolve) => setTimeout(resolve, 3000))]);
  });
  await page.waitForTimeout(300);
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const found = result.violations.map((v) => `[${v.impact}] ${v.id} ×${v.nodes.length} — ${v.nodes[0]?.target.join(" ")} :: ${(v.nodes[0]?.failureSummary ?? "").split("\n")[1] ?? ""}`);
  expect(found, `accessibility: ${label}`).toEqual([]);
}
