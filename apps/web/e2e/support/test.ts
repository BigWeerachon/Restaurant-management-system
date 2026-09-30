import { expect, test as base } from "@playwright/test";

/** Failures a test expects on purpose (say, a refusal with a 402), by the text of the report. */
export interface Watch {
  allow(pattern: RegExp): void;
  problems: string[];
}

/**
 * Every test also watches the browser: a page error, a console error, or a failed request (4xx/5xx) that the test did not
 * say it expected fails it. A screen that "works" while throwing in the background is not working.
 */
export const test = base.extend<{ watch: Watch }>({
  watch: [
    async ({ page }, use) => {
      const problems: string[] = [];
      const allowed: RegExp[] = [];
      const note = (text: string) => {
        if (!allowed.some((p) => p.test(text))) problems.push(text);
      };
      page.on("pageerror", (e) => note(`page error: ${String(e).slice(0, 200)}`));
      page.on("console", (m) => {
        // The browser also reports every failed request as a console error; failed requests are watched below, with their path.
        if (m.type() === "error" && !/favicon|Failed to load resource/i.test(m.text() + m.location().url)) note(`console error: ${m.text().slice(0, 200)}`);
      });
      page.on("response", (r) => {
        if (r.status() >= 400 && !/favicon/.test(r.url())) note(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
      });
      await use({ allow: (p) => void allowed.push(p), problems });
      expect(problems, "nothing went wrong in the browser").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
