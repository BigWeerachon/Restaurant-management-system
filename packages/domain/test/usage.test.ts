import { describe, expect, it } from "vitest";
import { branchUsageFee, USAGE_ORDERS_TO_CAP, usageStatement } from "../src";

// Same vectors as packages/db/tests/005_usage_billing.sql
describe("pay per order", () => {
  it("charges 0.50 baht a paid order, capped at 990 baht a branch", () => {
    expect(branchUsageFee(0)).toBe(0);
    expect(branchUsageFee(150)).toBe(7_500);
    expect(branchUsageFee(1_979)).toBe(98_950);
    expect(branchUsageFee(USAGE_ORDERS_TO_CAP)).toBe(99_000);
    expect(branchUsageFee(3_000)).toBe(99_000);
    expect(USAGE_ORDERS_TO_CAP).toBe(1_980);
  });
  it("carries a month under 100 baht", () => {
    expect(usageStatement([150, 0])).toEqual({ orders: 150, fee: 7_500, carriedIn: 0, total: 7_500, outcome: "carried" });
    expect(usageStatement([0])).toMatchObject({ total: 0, outcome: "nothing" });
  });
  it("caps each branch on its own and adds the carry", () => {
    expect(usageStatement([3_000, 100], 7_500)).toEqual({ orders: 3_100, fee: 104_000, carriedIn: 7_500, total: 111_500, outcome: "invoiced" });
  });
  it("rolls an unpaid bill into the next one even when the month is small", () => {
    expect(usageStatement([10], 0, 111_500)).toMatchObject({ total: 112_000, outcome: "invoiced" });
  });
});
