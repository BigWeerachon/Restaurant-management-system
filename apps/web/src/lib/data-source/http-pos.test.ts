import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSabai } from "../demo/store";
import { orderApi } from "./fixtures";
import { clearApiSession, setApiSession } from "./http-client";
import { httpDataSource as ds } from "./http-data-source";
import { offlineQueue, resetOfflineQueueForTests } from "./offline";

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


/** A till whose line is down (checklist 5.2): sales are kept on the device and sent later, once each. */
describe("HttpDataSource POS commands while offline", () => {
  let branchId: string;
  let channelId: string;
  let itemId: string;

  beforeEach(() => {
    clearApiSession();
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    resetOfflineQueueForTests();
    useSabai.getState().reset("demo");
    useSabai.getState().signIn("m-owner");
    const { db, session } = useSabai.getState();
    branchId = session.branchId!;
    channelId = db.channels.find((c) => c.active && c.kind === "dine_in")!.id;
    itemId = db.menuItems.find((m) => m.active && m.modifierGroupIds.length === 0 && !m.soldOut[branchId])!.id;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const goOffline = () => vi.stubGlobal("navigator", { onLine: false });
  const order = (id: string, qty = 2) => ({ id, channelId, guestCount: 0, items: [{ id: `${id}-1`, menuItemId: itemId, qty, modifierOptionIds: [] as string[] }] });
  const localOrder = (id: string) => useSabai.getState().db.orders.find((o) => o.id === id);

  it("keeps an order made while the browser says it is offline: no request, the till carries on, the order waits in the queue", async () => {
    goOffline();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(ds.submitOrder(order("ord-a"))).resolves.toEqual({ queued: true });

    expect(fetchSpy).not.toHaveBeenCalled();
    // The order exists here, with its lines, as if it had gone through.
    expect(localOrder("ord-a")).toMatchObject({ status: "open", branchId });
    expect(localOrder("ord-a")!.items).toHaveLength(1);
    const { items, pending } = offlineQueue().snapshot();
    expect(pending).toBe(1);
    expect(items[0]).toMatchObject({ kind: "submitOrder", orderId: "ord-a", path: "/v1/orders", tenantId: "t-1", branchId });
    expect(items[0]!.body).toMatchObject({ id: "ord-a", branchId, channelId, fire: true, items: [{ id: "ord-a-1", menuItemId: itemId, qty: 2 }] });
  });

  it("queues when the request itself fails to get through, and keeps the idempotency key it already tried with", async () => {
    vi.useFakeTimers();
    const keys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init: any) => {
        keys.push(init.headers["Idempotency-Key"]);
        throw new TypeError("fetch failed");
      }),
    );

    const pending = ds.submitOrder(order("ord-b"));
    await vi.advanceTimersByTimeAsync(5000); // the client's own retries (0.5 s, 1 s) run out first
    await expect(pending).resolves.toEqual({ queued: true });

    expect(new Set(keys).size).toBe(1); // every try carried the same key…
    expect(offlineQueue().snapshot().items[0]!.id).toBe(keys[0]); // …and it is the one the queue will use
  });

  it("does not queue a refusal from the server: the person sees why, exactly as when online", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(409, { error: { code: "MENU_ITEM_SOLD_OUT", details: { name: "x" } } })));
    await expect(ds.submitOrder(order("ord-c"))).rejects.toMatchObject({ code: "MENU_ITEM_SOLD_OUT" });
    expect(offlineQueue().snapshot().items).toEqual([]);
  });

  it("does not queue what is not valid here either (a sold-out item), so the queue never holds an order that cannot be made", async () => {
    useSabai.getState().patch((d) => {
      d.menuItems.find((m) => m.id === itemId)!.soldOut[branchId] = true;
    });
    goOffline();
    await expect(ds.submitOrder(order("ord-d"))).rejects.toMatchObject({ code: "MENU_ITEM_SOLD_OUT" });
    expect(offlineQueue().snapshot().items).toEqual([]);
    expect(localOrder("ord-d")).toBeUndefined();
  });

  it("takes payment offline: the order is paid here, but with no receipt number (the server's to give), and the payment waits behind the order", async () => {
    goOffline();
    await ds.submitOrder(order("ord-e"));
    const total = localOrder("ord-e")!.totals.total;
    const cash = useSabai.getState().db.paymentMethods.find((m) => m.active && m.kind === "cash")!;

    await expect(ds.payOrder("ord-e", [{ methodId: cash.id, amount: total, tendered: total + 5000 }])).resolves.toEqual({ queued: true });

    expect(localOrder("ord-e")).toMatchObject({ status: "paid", receiptNo: undefined });
    expect(localOrder("ord-e")!.payments[0]).toMatchObject({ amount: total, tendered: total + 5000, change: 5000 });
    const items = offlineQueue().snapshot().items;
    expect(items.map((c) => c.kind)).toEqual(["submitOrder", "payOrder"]);
    expect(items[1]).toMatchObject({ path: "/v1/orders/ord-e/pay" });
    expect((items[1]!.body as any).payments[0]).toMatchObject({ methodId: cash.id, amount: (total / 100).toFixed(2), tendered: ((total + 5000) / 100).toFixed(2) });
  });

  it("once something for an order is waiting, later commands for it wait too even if the line is back, so the server sees them in order", async () => {
    goOffline();
    await ds.submitOrder(order("ord-f"));
    vi.unstubAllGlobals(); // back online
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const total = localOrder("ord-f")!.totals.total;
    const cash = useSabai.getState().db.paymentMethods.find((m) => m.active && m.kind === "cash")!;
    await expect(ds.payOrder("ord-f", [{ methodId: cash.id, amount: total }])).resolves.toEqual({ queued: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(offlineQueue().snapshot().pending).toBe(2);
  });

  it("an order for another bill still goes straight through while this one waits", async () => {
    goOffline();
    await ds.submitOrder(order("ord-g"));
    vi.unstubAllGlobals();
    const calls = fakeApi({ "POST /v1/orders": { id: "ord-h" }, "GET /v1/orders": [] });
    await expect(ds.submitOrder(order("ord-h"))).resolves.toEqual({ queued: false });
    expect(calls.some((c) => c.key === "POST /v1/orders")).toBe(true);
  });

  it("a reload of the day's orders keeps an order that is still waiting, and drops the local copy once it has been sent", async () => {
    goOffline();
    await ds.submitOrder(order("ord-i"));
    vi.unstubAllGlobals();

    fakeApi({ "GET /v1/orders": [] });
    await ds.load(["orders"]);
    expect(localOrder("ord-i")).toBeDefined(); // the server has not heard of it yet

    const calls = fakeApi({ "POST /v1/orders": { id: "ord-i" }, "GET /v1/orders": [orderApi({ branchId, id: "ord-i" })] });
    const result = await offlineQueue().drain();
    expect(result).toEqual({ sent: 1, stopped: null });
    const post = calls.find((c) => c.key === "POST /v1/orders")!;
    expect(post.body).toMatchObject({ id: "ord-i" });

    await ds.load(["orders"]);
    expect(offlineQueue().snapshot().items).toEqual([]);
    expect(localOrder("ord-i")).toMatchObject({ id: "ord-i" });
  });

  it("replays with the very key it was first tried with, so a first try that did get through is not done twice", async () => {
    goOffline();
    await ds.submitOrder(order("ord-j"));
    vi.unstubAllGlobals();
    const queuedKey = offlineQueue().snapshot().items[0]!.id;

    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: any) => {
        if (init?.method === "POST") seen.push(init.headers["Idempotency-Key"]);
        return json(200, new URL(String(url)).pathname === "/v1/orders" && init?.method !== "POST" ? [] : { id: "ord-j" });
      }),
    );
    await offlineQueue().drain();
    await offlineQueue().drain(); // nothing left: it must not send again
    expect(seen).toEqual([queuedKey]);
  });
});
