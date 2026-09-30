import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { routeRegistry } from "../src/http";
import { createLogger } from "../src/logger";

// docs/06-api.md is what a client developer reads first. It may not lag behind what the API does — nor promise what it
// does not. (The generated OpenAPI document is always right; this keeps the prose as right.)
const doc = readFileSync(resolve(__dirname, "../../../docs/06-api.md"), "utf8");
createApp({ sql: {} as never, config: loadConfig({}), log: createLogger({ silent: true }) });
const actual = [...new Set(routeRegistry.map((r) => `${r.method} ${r.path}`))].sort();
const documented = [...new Set([...doc.matchAll(/\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`(\/[^`]+)`/g)].map((m) => `${m[1]} ${m[2]}`))].sort();

describe("the API documentation", () => {
  it("lists every endpoint the API serves", () => {
    expect(actual.filter((r) => !documented.includes(r)), "served but not in docs/06-api.md").toEqual([]);
  });

  it("does not list an endpoint the API does not serve", () => {
    expect(documented.filter((r) => !actual.includes(r)), "in docs/06-api.md but not served").toEqual([]);
  });

  it("says how many there are, correctly", () => {
    const said = /\*\*(\d+) endpoints/.exec(doc)?.[1];
    expect(Number(said), "the count in the first paragraph").toBe(actual.length);
  });
});
