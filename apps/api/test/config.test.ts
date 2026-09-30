import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("rate limits", () => {
  it("allow 10 PIN tries a minute unless the deployment says otherwise", () => {
    expect(loadConfig({}).limits.pinAttemptsPerMinute).toBe(10);
    expect(loadConfig({ PIN_ATTEMPTS_PER_MINUTE: "1000" }).limits.pinAttemptsPerMinute).toBe(1000);
    expect(loadConfig({ PIN_ATTEMPTS_PER_MINUTE: "3.9" }).limits.pinAttemptsPerMinute).toBe(3);
  });

  it("never turn the limit off by accident: nonsense, zero and negatives read as the default or 1", () => {
    expect(loadConfig({ PIN_ATTEMPTS_PER_MINUTE: "abc" }).limits.pinAttemptsPerMinute).toBe(10);
    expect(loadConfig({ PIN_ATTEMPTS_PER_MINUTE: "0" }).limits.pinAttemptsPerMinute).toBe(10);
    expect(loadConfig({ PIN_ATTEMPTS_PER_MINUTE: "-5" }).limits.pinAttemptsPerMinute).toBe(1);
  });
});
