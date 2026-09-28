import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cheapestPlanFor, PLANS, planAllows, planLimit } from "../src";

const sql = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260927000800_saas_billing.sql", import.meta.url)), "utf8");

describe("plans", () => {
  it("match app.plans in the database (limits, features, price)", () => {
    const rows = [...sql.matchAll(/\('(\w+)', '[^']*', '[^']*', (\w+), (\w+),\s*'(\{[^']*\})',\s*'\{([^}]*)\}'/g)];
    expect(rows.length).toBe(PLANS.length);
    for (const [, code, monthly, yearly, limits, features] of rows) {
      const p = PLANS.find((x) => x.code === code)!;
      expect(p, code).toBeDefined();
      expect(p.priceMonthly).toBe(monthly === "null" ? null : Number(monthly));
      expect(p.priceYearly).toBe(yearly === "null" ? null : Number(yearly));
      expect(p.limits).toEqual(JSON.parse(limits!));
      expect([...p.features].sort()).toEqual(features!.split(",").sort());
    }
  });
  it("answers limits and features", () => {
    expect(planLimit("pro", "branches")).toBe(3);
    expect(planLimit("enterprise", "branches")).toBeNull();
    expect(planAllows("starter", "reports_profit")).toBe(false);
    expect(planAllows("pro", "reconciliation")).toBe(true);
  });
  it("suggests the cheapest plan that fits", () => {
    expect(cheapestPlanFor({ branches: 2 }).code).toBe("pro");
    expect(cheapestPlanFor({ feature: "central_kitchen" }).code).toBe("business");
    expect(cheapestPlanFor({ branches: 50 }).code).toBe("enterprise");
  });
});
