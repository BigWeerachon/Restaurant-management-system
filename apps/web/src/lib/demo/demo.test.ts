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

  it("compares today with the same weekday last week without bias, at any time of day", { timeout: 30_000 }, () => {
    // A single morning has only ~20 orders, so one day swings by more than 100% either way (the generators are
    // seeded by date). What must hold is that there is no systematic skew — e.g. today's partial day compared
    // with last week's whole day would read about -50% or worse — so measure it over fixed dates: the result
    // never depends on which day the suite happens to run.
    const dates = Array.from({ length: 14 }, (_, i) => addDays("2026-03-02", i));
    // 09:15, 13:40 and 20:05 in Bangkok, whatever the machine's own time zone.
    for (const iso of ["T02:15:00Z", "T06:40:00Z", "T13:05:00Z"]) {
      let sales = 0;
      let lastWeekSales = 0;
      for (const date of dates) {
        const at = new Date(`${date}${iso}`);
        const base = sampleState(date);
        const history = generateHistory(base, date);
        const s = produce(base, (d) => seedLive(d, at, date, history));
        const t = todayStats(s, history, "br-ari", at);
        sales += t.sales;
        lastWeekSales += t.lastWeekSales;
      }
      const bias = sales / lastWeekSales - 1;
      expect(Math.abs(bias), `${iso}: ${(bias * 100).toFixed(1)}%`).toBeLessThan(0.2);
    }
  });

  it("builds the recent fortnight of the history with exactly the rows the full history holds", () => {
    const base = sampleState(today);
    const full = generateHistory(base, today);
    const recent = generateHistory(base, today, 30, 16);
    const from = addDays(today, -16);
    expect(recent.days.length).toBeGreaterThan(0);
    expect(recent.days).toEqual(full.days.filter((d) => d.date >= from));
    expect(recent.branchDays).toEqual(full.branchDays.filter((d) => d.date >= from));
    // The home screen reads the same numbers from either.
    const a = todayStats(sample(), recent, "br-ari", now);
    const b = todayStats(sample(), full, "br-ari", now);
    expect(a.spark).toEqual(b.spark);
    expect([a.lastWeekSales, a.lastWeekOrders]).toEqual([b.lastWeekSales, b.lastWeekOrders]);
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

  it("takes 'enough for ~N days' from the week's usage the server counted, when it sends one — not from the movements it happens to hold", () => {
    const s = sample();
    const row = stockRows(s, "br-ari", now).find((r) => r.qty > 0)!;
    const key = `br-ari:${row.ingredient.id}`;
    // A busy shop holds only the last few hundred movements, which say almost nothing about the week: the server's count wins.
    const counted = produce(s, (d) => {
      d.movements = [];
      d.balances[key] = { ...d.balances[key]!, usage7d: row.qty * 7 / 4 };
    });
    expect(stockRows(counted, "br-ari", now).find((r) => r.ingredient.id === row.ingredient.id)!.daysLeft).toBeCloseTo(4, 6);
    // Nothing used all week: no estimate, rather than "forever".
    const unused = produce(counted, (d) => { d.balances[key]!.usage7d = 0; });
    expect(stockRows(unused, "br-ari", now).find((r) => r.ingredient.id === row.ingredient.id)!.daysLeft).toBeNull();
    // The demo never sends one and keeps working it out from its own movements.
    const worked = produce(s, (d) => { delete d.balances[key]!.usage7d; });
    expect(stockRows(worked, "br-ari", now).find((r) => r.ingredient.id === row.ingredient.id)!.daysLeft).toEqual(row.daysLeft);
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
