import { beforeEach, describe, expect, it } from "vitest";
import { useSabai } from "../demo/store";
import { demoDataSource as ds } from "./demo-data-source";

// vitest runs in a plain node environment (no browser storage); zustand's
// persist middleware only logs a warning when it's missing, but a stub keeps
// test output clean.
if (typeof globalThis.localStorage === "undefined") {
  const memory = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
    clear: () => memory.clear(),
    key: (i) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
  } as Storage;
}

// "demo" mode seeds a lively day already in progress, including an open
// shift — reuse it instead of colliding with SHIFT_ALREADY_OPEN.
async function ensureShift(branchId: string): Promise<string> {
  const existing = useSabai.getState().db.shifts.find((s) => s.branchId === branchId && s.status === "open");
  return existing ? existing.id : ds.openShift(100000);
}

describe("DemoDataSource", () => {
  beforeEach(() => {
    useSabai.getState().reset("demo");
  });

  it("signs in, opens a shift, sells, pays, and closes — matching direct engine calls", async () => {
    const db0 = useSabai.getState().db;
    const owner = db0.members.find((m) => m.roleKey === "owner")!;
    const branch = db0.branches[0]!;
    await ds.signIn(owner.id, branch.id);

    const shiftId = await ensureShift(branch.id);
    expect(typeof shiftId).toBe("string");
    expect(useSabai.getState().db.shifts.find((s) => s.id === shiftId)?.status).toBe("open");

    const item = db0.menuItems.find((m) => m.route === "bar")!;
    const orderId = "test-order-1";
    await ds.submitOrder({ id: orderId, channelId: db0.channels.find((c) => c.kind === "dine_in")!.id, items: [{ id: "i1", menuItemId: item.id, qty: 1, modifierOptionIds: [] }] });
    const order = useSabai.getState().db.orders.find((o) => o.id === orderId)!;
    expect(order.status).toBe("open");
    expect(order.totals.total).toBeGreaterThan(0);

    const cash = db0.paymentMethods.find((p) => p.kind === "cash")!;
    await ds.payOrder(orderId, [{ methodId: cash.id, amount: order.totals.total }]);
    expect(useSabai.getState().db.orders.find((o) => o.id === orderId)!.status).toBe("paid");

    const closed = await ds.closeShift(useSabai.getState().db.shifts.find((s) => s.id === shiftId)!.expectedCash ?? 100000);
    expect(closed.variance).toBeDefined();
  });

  it("routes an approval-required discount through approve() and a retried command, same as the UI does", async () => {
    const db0 = useSabai.getState().db;
    const owner = db0.members.find((m) => m.roleKey === "owner")!;
    const cashier = db0.members.find((m) => m.roleKey === "cashier")!;
    const manager = db0.members.find((m) => m.roleKey === "manager")!;
    const branch = db0.branches[0]!;
    await ds.signIn(owner.id, branch.id);
    await ensureShift(branch.id);

    const item = db0.menuItems.find((m) => m.route === "bar")!;
    const orderId = "test-order-2";
    await ds.submitOrder({ id: orderId, channelId: db0.channels.find((c) => c.kind === "dine_in")!.id, items: [{ id: "i1", menuItemId: item.id, qty: 3, modifierOptionIds: [] }] });

    await ds.signIn(cashier.id, branch.id);
    await expect(ds.applyDiscount(orderId, "percent", 20, "ลูกค้าประจำ")).rejects.toThrow("APPROVAL_REQUIRED");

    const approval = await ds.approve("pos.discount", manager.pin);
    expect(approval.value).toBe(manager.id);
    await ds.applyDiscount(orderId, "percent", 20, "ลูกค้าประจำ", approval);
    expect(useSabai.getState().db.orders.find((o) => o.id === orderId)!.discount?.approvedBy).toBe(manager.id);
  });

  it("has no accounts, so 'enter with my account' enters as the owner", async () => {
    const member = await ds.signInAsAccount();
    expect(member.roleKey).toBe("owner");
    expect(useSabai.getState().session.memberId).toBe(member.id);
  });

  it("toggles one kitchen ticket item without bumping the rest", async () => {
    const db0 = useSabai.getState().db;
    const owner = db0.members.find((m) => m.roleKey === "owner")!;
    const branch = db0.branches[0]!;
    await ds.signIn(owner.id, branch.id);
    await ensureShift(branch.id);
    const items = db0.menuItems.filter((m) => m.route === "kitchen").slice(0, 2);
    const orderId = "test-order-3";
    await ds.submitOrder({
      id: orderId,
      channelId: db0.channels.find((c) => c.kind === "dine_in")!.id,
      items: items.map((m, i) => ({ id: `i${i}`, menuItemId: m.id, qty: 1, modifierOptionIds: [] })),
    });
    const ticket = useSabai.getState().db.tickets.find((t) => t.orderId === orderId)!;
    const [first, second] = ticket.items;
    await ds.toggleTicketItem(ticket.id, first!.orderItemId);
    const after = useSabai.getState().db.tickets.find((t) => t.id === ticket.id)!;
    expect(after.items.find((i) => i.orderItemId === first!.orderItemId)!.status).toBe("done");
    expect(after.items.find((i) => i.orderItemId === second!.orderItemId)!.status).toBe("pending");
  });
});
