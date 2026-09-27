import { describe, expect, it } from "vitest";
import {
  accessFromRole,
  can,
  codeFromDatabaseError,
  ERROR_CATALOG,
  homeFor,
  humanizeError,
  MAX_PRIMARY_NAV,
  navigationFor,
  onboardingProgress,
  PERMISSIONS,
  quickActionsFor,
  ROLE_TEMPLATES,
  roleTemplate,
  shortReference,
} from "../src";

describe("permissions & role templates", () => {
  it("has unique, well-formed permission keys", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z_]+\.[a-z_]+$/);
    expect(keys).toHaveLength(34);
  });

  it("role templates only reference catalog permissions", () => {
    const keys = new Set<string>(PERMISSIONS.map((p) => p.key));
    for (const r of ROLE_TEMPLATES) for (const p of r.permissions) expect(keys.has(p)).toBe(true);
  });

  it("a waiter can take orders but not payments, discounts or money reports", () => {
    const waiter = accessFromRole(roleTemplate("waiter"));
    expect(can(waiter, "pos.order")).toBe(true);
    expect(can(waiter, "pos.pay")).toBe(false);
    expect(can(waiter, "pos.discount")).toBe(false);
    expect(can(waiter, "reports.profit")).toBe(false);
  });

  it("kitchen sees recipes but never costs", () => {
    const kitchen = accessFromRole(roleTemplate("kitchen"));
    expect(can(kitchen, "recipes.view")).toBe(true);
    expect(can(kitchen, "costs.view")).toBe(false);
  });

  it("owners hold every permission, including future ones", () => {
    const owner = { grantsAll: true, permissions: new Set<string>() };
    expect(can(owner, "billing.manage")).toBe(true);
  });
});

describe("role-based navigation", () => {
  it("keeps every role within five primary destinations", () => {
    for (const r of ROLE_TEMPLATES) {
      const nav = navigationFor(accessFromRole(r), r.key);
      expect(nav.primary.length).toBeLessThanOrEqual(MAX_PRIMARY_NAV);
    }
  });

  it("puts each role's main job first", () => {
    expect(navigationFor(accessFromRole(roleTemplate("cashier")), "cashier").primary.map((n) => n.key)).toEqual(["pos", "orders", "kds"]);
    expect(navigationFor(accessFromRole(roleTemplate("kitchen")), "kitchen").primary[0]!.key).toBe("kds");
    expect(navigationFor(accessFromRole(roleTemplate("accountant")), "accountant").primary[0]!.key).toBe("finance");
    const owner = navigationFor(accessFromRole(roleTemplate("owner")), "owner");
    expect(owner.primary[0]!.key).toBe("today");
    expect(owner.more.length).toBeGreaterThan(0);
  });

  it("lands people on their work surface", () => {
    expect(homeFor(accessFromRole(roleTemplate("kitchen")), "kds")).toBe("/kds");
    expect(homeFor(accessFromRole(roleTemplate("waiter")), "today")).toBe("/pos");
  });

  it("offers quick actions only for allowed tasks", () => {
    const stock = quickActionsFor(accessFromRole(roleTemplate("stock"))).map((a) => a.key);
    expect(stock).toContain("receive");
    expect(stock).not.toContain("close");
    expect(stock).not.toContain("sell");
  });
});

describe("onboarding progress", () => {
  const empty = { branchReady: false, paymentsReady: false, ingredients: 0, menuItems: 0, recipes: 0, staff: 1, hasSale: false, skipped: [] };

  it("starts at zero and points to the first step", () => {
    const p = onboardingProgress(empty);
    expect(p.percent).toBe(0);
    expect(p.next?.key).toBe("branch");
    expect(p.isComplete).toBe(false);
    expect(p.minutesLeft).toBeGreaterThan(0);
  });

  it("derives progress from real data and honours skipped optional steps", () => {
    const p = onboardingProgress({ ...empty, branchReady: true, paymentsReady: true, ingredients: 3, menuItems: 1, skipped: ["recipe", "staff", "branch"] });
    expect(p.steps.find((s) => s.key === "recipe")?.status).toBe("skipped");
    // Required steps can't be skipped away.
    expect(p.steps.find((s) => s.key === "first_sale")?.status).toBe("todo");
    expect(p.next?.key).toBe("first_sale");
    expect(p.percent).toBe(86);
  });

  it("completes when everything is resolved", () => {
    const p = onboardingProgress({ ...empty, branchReady: true, paymentsReady: true, ingredients: 1, menuItems: 1, recipes: 1, staff: 2, hasSale: true });
    expect(p.isComplete).toBe(true);
    expect(p.percent).toBe(100);
  });
});

describe("human error messages", () => {
  it("every catalog entry produces Thai + English copy and an action", () => {
    for (const [code, fn] of Object.entries(ERROR_CATALOG)) {
      const copy = fn({});
      expect(copy.title.length, code).toBeGreaterThan(0);
      expect(copy.message.length, code).toBeGreaterThan(0);
      expect(copy.titleEn.length, code).toBeGreaterThan(0);
      expect(copy.actionLabel.length, code).toBeGreaterThan(0);
      // Never leak technical jargon to staff.
      expect(copy.message).not.toMatch(/sql|stack|exception|null|undefined|500/i);
    }
  });

  it("fills in details for the person", () => {
    expect(humanizeError("MENU_ITEM_SOLD_OUT", { name: "ลาเต้เย็น" }).message).toContain("ลาเต้เย็น");
    expect(humanizeError("PAYMENT_TOTAL_MISMATCH", { total: 145, paid: 100 }).message).toContain("฿145.00");
    expect(humanizeError("OPEN_ORDERS_EXIST", { count: 2 }).message).toContain("2 บิล");
  });

  it("falls back calmly with a reference for unknown failures", () => {
    const e = humanizeError("relation \"x\" does not exist", {}, "8F2K-Q1AB");
    expect(e.code).toBe("INTERNAL");
    expect(e.reference).toBe("8F2K-Q1AB");
    expect(e.message).not.toContain("relation");
  });

  it("maps database errors to domain codes", () => {
    expect(codeFromDatabaseError({ code: "P0001", message: "PERIOD_CLOSED" })).toBe("PERIOD_CLOSED");
    expect(codeFromDatabaseError({ code: "P0001", message: "something else" })).toBe("INTERNAL");
    expect(codeFromDatabaseError({ code: "23505" })).toBe("CONFLICT");
    expect(codeFromDatabaseError({ code: "42501" })).toBe("PERMISSION_DENIED");
  });

  it("creates short references staff can read aloud", () => {
    expect(shortReference("01a0e339-25b1-7bcb-b330-c5e55f15106f")).toBe("5F15-106F");
  });
});
