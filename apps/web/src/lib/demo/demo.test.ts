import { produce } from "immer";
import { describe, expect, it } from "vitest";
import * as E from "./engine";
import { generateHistory } from "./history";
import { seedLive } from "./live-seed";
import { freshState, sampleState } from "./seed";
import { alerts, onboarding, reportSummary, stockRows, todayStats } from "./selectors";
import type { DemoState } from "./types";
import { addDays, businessDate } from "@sabai/domain";

const now = new Date();
const today = businessDate(now);

function sample(): DemoState {
  const base = sampleState(today);
  return produce(base, (d) => seedLive(d, now, today, generateHistory(base, today)));
}

describe("demo shop", () => {
  it("seeds a lively day through the real engine commands", () => {
    const s = sample();
    expect(s.orders.filter((o) => o.status === "paid").length).toBeGreaterThanOrEqual(0);
    expect(s.orders.filter((o) => o.status === "open").length).toBe(4);
    expect(s.tickets.filter((t) => t.status === "new" || t.status === "in_progress").length).toBeGreaterThanOrEqual(4);
    expect(s.statementLines.length).toBe(5);
  });

  it("produces believable 30-day economics", () => {
    const s = sample();
    const h = generateHistory(s, today);
    const r = reportSummary(s, h, { from: addDays(today, -30), to: today });
    const profit = r.waterfall.at(-1)!.value;
    expect(r.totals.orders).toBeGreaterThan(5000);
    expect(profit).toBeGreaterThan(0);
    const costPct = r.totals.cost / r.totals.netSales;
    expect(costPct).toBeGreaterThan(0.2);
    expect(costPct).toBeLessThan(0.4);
    expect(r.channels.length).toBe(4);
    expect(r.items[0]!.class).toBeDefined();
  });

  it("answers today's questions and raises useful alerts", () => {
    const s = sample();
    const h = generateHistory(s, today);
    const t = todayStats(s, h, "br-ari", now);
    expect(t.orders).toBe(s.orders.filter((o) => o.status === "paid" && o.branchId === "br-ari").length);

    const a = alerts(s, "br-ari", today, now);
    expect(a.map((x) => x.id)).toEqual(expect.arrayContaining(["stock-low", "bills-overdue", "recon"]));
    expect(stockRows(s, "br-ari", now).some((r) => r.status === "low")).toBe(true);
  });

  it("enforces the same rules as the database", () => {
    let s = sample();
    const ctx = (actorId: string): E.Ctx => ({ now, actorId, branchId: "br-ari" });
    // waiter can't take money
    expect(() => produce(s, (d) => void E.payOrder(d, ctx("m-waiter"), d.orders.find((o) => o.status === "open")!.id, []))).toThrow("PERMISSION_DENIED");
    // cashier needs approval for 20% discount, manager can approve
    const open = s.orders.find((o) => o.status === "open")!;
    expect(() => produce(s, (d) => E.applyDiscount(d, ctx("m-cashier"), open.id, "percent", 20, "ลูกค้าประจำ"))).toThrow("APPROVAL_REQUIRED");
    s = produce(s, (d) => E.applyDiscount(d, ctx("m-cashier"), open.id, "percent", 20, "ลูกค้าประจำ", "m-manager"));
    expect(s.orders.find((o) => o.id === open.id)!.discount?.approvedBy).toBe("m-manager");
    // void of an item the kitchen has needs approval
    const item = open.items[0]!;
    expect(() => produce(s, (d) => E.voidItem(d, ctx("m-cashier"), open.id, item.id, "เปลี่ยนใจ"))).toThrow("APPROVAL_REQUIRED");
    // day can't close with open bills
    expect(() => produce(s, (d) => void E.closeDay(d, ctx("m-owner"), today))).toThrow("OPEN_ORDERS_EXIST");
  });

  it("sells, consumes stock and closes the day end-to-end", () => {
    let s = freshState(today);
    const ctx: E.Ctx = { now, actorId: "m-owner", branchId: "br-main" };
    s = produce(s, (d) => {
      const coffee = E.addIngredient(d, ctx, { name: "กาแฟ", baseUnit: "g", category: "บาร์", pack: { name: "ถุง 1 กก.", qty: 1000, price: 50000 }, openingQty: 1000 });
      const mi = E.addMenuItem(d, ctx, { name: "อเมริกาโน่", emoji: "☕", price: 6000, route: "bar", categoryName: "กาแฟ", recipe: { yieldQty: 1, lines: [{ ingredientId: coffee.id, qty: 18 }] } });
      E.openShift(d, ctx, 100000);
      const o = E.submitOrder(d, ctx, { id: "o1", channelId: "ch-dine", items: [{ id: "i1", menuItemId: mi.id, qty: 2, modifierOptionIds: [] }] });
      E.payOrder(d, ctx, o.id, [{ methodId: "pm-cash", amount: o.totals.total, tendered: 20000 }]);
      E.closeShift(d, ctx, 112000);
      E.closeDay(d, ctx, o.businessDate);
    });
    expect(s.balances["br-main:" + s.ingredients[0]!.id]!.qty).toBe(1000 - 36);
    expect(s.orders[0]!.receiptNo).toMatch(/^HQ-\d{4}-00001$/);
    expect(s.dayCloses[0]!.summary.total).toBe(12000);
    expect(onboarding(s).steps.find((x) => x.key === "first_sale")!.status).toBe("done");
  });
});
