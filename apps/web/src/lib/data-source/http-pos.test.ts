import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSabai } from "../demo/store";
import { orderApi } from "./fixtures";
import { clearApiSession, setApiSession } from "./http-client";
import { httpDataSource as ds } from "./http-data-source";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Answers by "METHOD /path" and records every request, so a test can check what was sent and what was reloaded afterwards. */
function fakeApi(routes: Record<string, unknown>) {
  const calls: { key: string; url: string; body: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: any) => {
      const u = new URL(String(url));
      const key = `${init?.method ?? "GET"} ${u.pathname}`;
      calls.push({ key, url: u.pathname + u.search, body: init?.body ? JSON.parse(init.body) : undefined });
      return key in routes ? json(200, routes[key]) : json(404, { error: { code: "NOT_FOUND" } });
    }),
  );
  return calls;
}

const noShift = { "GET /v1/shifts/current": { shift: null, suggestedOpeningFloat: "1000.00" }, "GET /v1/shifts": [] };

describe("HttpDataSource POS commands", () => {
  let branchId: string;
  beforeEach(() => {
    clearApiSession();
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    useSabai.getState().reset("demo");
    useSabai.getState().signIn("m-owner");
    branchId = useSabai.getState().session.branchId!;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an order to the kitchen with this branch and reloads the day's orders", async () => {
    const calls = fakeApi({ "POST /v1/orders": { id: "o-1" }, "GET /v1/orders": [orderApi({ branchId })] });
    await ds.submitOrder({ id: "o-1", channelId: "ch-1", tableId: "t-1", guestCount: 0, items: [{ id: "oi-1", menuItemId: "mi-1", qty: 2, note: "ไม่หวาน", modifierOptionIds: ["mo-1"] }] });

    expect(calls[0]!.body).toEqual({ id: "o-1", branchId, channelId: "ch-1", tableId: "t-1", fire: true, items: [{ id: "oi-1", menuItemId: "mi-1", qty: 2, note: "ไม่หวาน", modifierOptionIds: ["mo-1"] }] });
    expect(calls.find((c) => c.key === "GET /v1/orders")!.url).toContain(`branchId=${branchId}&detail=full`);
    // Only this branch's orders are replaced: the demo orders of this branch are gone, the loaded one is there.
    const mine = useSabai.getState().db.orders.filter((o) => o.branchId === branchId);
    expect(mine.map((o) => o.id)).toEqual(["o-1"]);
  });

  it("pays in baht strings, sends the tendered cash, and reloads orders and the shift", async () => {
    const calls = fakeApi({ "POST /v1/orders/o-1/pay": { id: "o-1", status: "paid" }, "GET /v1/orders": [], ...noShift });
    await ds.payOrder("o-1", [{ methodId: "pm-cash", amount: 18500, tendered: 50000 }, { methodId: "pm-qr", amount: 5, reference: "TXN9" }]);

    expect(calls[0]!.body).toEqual({
      payments: [
        { methodId: "pm-cash", amount: "185.00", tendered: "500.00" },
        { methodId: "pm-qr", amount: "0.05", reference: "TXN9" },
      ],
    });
    expect(calls.map((c) => c.key)).toEqual(expect.arrayContaining(["GET /v1/orders", "GET /v1/shifts/current", "GET /v1/shifts"]));
  });

  it("gives a discount as a percent, or a fixed amount converted to baht, carrying the manager's approval", async () => {
    const calls = fakeApi({ "POST /v1/orders/o-1/discount": {}, "GET /v1/orders": [] });
    await ds.applyDiscount("o-1", "percent", 12.5, "โปรเปิดร้าน");
    await ds.applyDiscount("o-1", "amount", 2050, "ลูกค้าประจำ", { value: "ap-1" });
    const sent = calls.filter((c) => c.key === "POST /v1/orders/o-1/discount").map((c) => c.body);
    expect(sent).toEqual([
      { type: "percent", value: 12.5, reason: "โปรเปิดร้าน" },
      { type: "amount", value: 20.5, reason: "ลูกค้าประจำ", approvalId: "ap-1" },
    ]);
  });

  it("voids one item or the whole bill, and refunds with the restock choice", async () => {
    const calls = fakeApi({ "POST /v1/order-items/oi-1/void": {}, "POST /v1/orders/o-1/void": {}, "POST /v1/orders/o-1/refund": {}, "GET /v1/orders": [], ...noShift });
    await ds.voidItem("o-1", "oi-1", "สั่งผิด", { value: "ap-2" });
    await ds.voidOrder("o-1", "ลูกค้าเปลี่ยนใจ");
    await ds.refundOrder("o-1", "อาหารไม่ถูกใจ", true, { value: "ap-3" });
    const bodies = Object.fromEntries(calls.filter((c) => c.key.startsWith("POST")).map((c) => [c.key, c.body]));
    expect(bodies).toEqual({
      "POST /v1/order-items/oi-1/void": { reason: "สั่งผิด", approvalId: "ap-2" },
      "POST /v1/orders/o-1/void": { reason: "ลูกค้าเปลี่ยนใจ" },
      "POST /v1/orders/o-1/refund": { reason: "อาหารไม่ถูกใจ", restock: true, approvalId: "ap-3" },
    });
  });

  it("opens a shift, then closes it with the counted cash and reports the difference in satang", async () => {
    const shiftRow = { id: "sh-1", opened_at: "2026-09-29T02:00:00Z", opened_by: "m-owner", opening_float: "1000.00", business_date: "2026-09-29", expected_cash: "1000.00", cash_movements: [] };
    const opened = fakeApi({ "POST /v1/shifts": { id: "sh-1" }, "GET /v1/shifts/current": { shift: shiftRow }, "GET /v1/shifts": [] });
    expect(await ds.openShift(100000)).toBe("sh-1");
    expect(opened[0]!.body).toEqual({ branchId, openingFloat: "1000.00" });
    expect(useSabai.getState().db.shifts.find((s) => s.branchId === branchId && s.status === "open")).toMatchObject({ id: "sh-1", expectedCash: 100000 });

    const closed = fakeApi({ "POST /v1/shifts/sh-1/close": { expectedCash: "1185.00", countedCash: "1180.00", variance: "-5.00" }, "GET /v1/orders": [], ...noShift });
    expect(await ds.closeShift(118000)).toEqual({ expected: 118500, counted: 118000, variance: -500 });
    expect(closed[0]!.body).toEqual({ countedCash: "1180.00" });
  });

  it("records cash in and out of the drawer against the open shift", async () => {
    const shiftRow = { id: "sh-1", opened_at: "x", opened_by: "m-owner", opening_float: "0.00", business_date: "2026-09-29", expected_cash: "0.00", cash_movements: [] };
    fakeApi({ "POST /v1/shifts": { id: "sh-1" }, "GET /v1/shifts/current": { shift: shiftRow }, "GET /v1/shifts": [] });
    await ds.openShift(0);
    const calls = fakeApi({ "POST /v1/shifts/sh-1/cash-movements": {}, "GET /v1/shifts/current": { shift: shiftRow }, "GET /v1/shifts": [] });
    await ds.cashMove("pay_out", 30050, "ซื้อน้ำแข็ง");
    expect(calls[0]!.body).toEqual({ kind: "pay_out", amount: "300.50", reason: "ซื้อน้ำแข็ง" });
  });

  it("refuses to touch the drawer when no shift is open", async () => {
    useSabai.getState().patch((d) => {
      d.shifts = [];
    });
    fakeApi(noShift);
    await ds.cashMove("pay_in", 100, "x").then(
      () => expect.unreachable(),
      (e) => expect(e).toMatchObject({ code: "SHIFT_NOT_OPEN" }),
    );
  });

  it("marks a menu item sold out for this branch only, then shows it as sold out", async () => {
    const itemId = useSabai.getState().db.menuItems[0]!.id;
    const calls = fakeApi({ [`POST /v1/menu-items/${itemId}/availability`]: { ok: true }, "GET /v1/catalog": { items: [{ id: itemId, sold_out: true }] } });
    await ds.setSoldOut(itemId, true);
    expect(calls[0]!.body).toEqual({ branchId, available: false });
    expect(useSabai.getState().db.menuItems[0]!.soldOut[branchId]).toBe(true);
  });

  it("still reports success when only the follow-up reload fails, leaving the store as it was", async () => {
    fakeApi({ "POST /v1/orders/o-1/void": {} });
    const before = useSabai.getState().db.orders;
    await expect(ds.voidOrder("o-1", "x")).resolves.toBeUndefined();
    expect(useSabai.getState().db.orders).toBe(before);
  });
});
