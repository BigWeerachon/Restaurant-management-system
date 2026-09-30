/** POS commands for the API adapter: shifts, orders, payments, availability. */
import { toSatang } from "@sabai/domain";
import { DomainError, openShiftOf } from "../demo/engine";
import { formatBaht } from "../demo/selectors";
import { useSabai } from "../demo/store";
import { demoDataSource } from "./demo-data-source";
import { baht, currentBranchId, refresh } from "./http-context";
import { apiFetch, getApiSession, newIdempotencyKey } from "./http-client";
import { offlineQueue } from "./offline";
import type { DataSource, Slice } from "./types";

function openShiftId(): string {
  const shift = openShiftOf(useSabai.getState().db, currentBranchId());
  if (!shift) throw new DomainError("SHIFT_NOT_OPEN");
  return shift.id;
}

/**
 * Sends a sale command — or, when the line is down, keeps it. A queued command is first applied on this device with the
 * demo engine (which follows the same rules as the database), so the till carries on as if it had gone through; the
 * server gets it, with the same idempotency key, as soon as the line is back. Nothing is queued unless it is valid here.
 *
 * Once anything for an order is waiting, everything after it for that order waits too, so the server sees them in order.
 */
async function sendOrQueue(
  cmd: { kind: "submitOrder" | "payOrder"; orderId: string; path: string; body: unknown; summary: string },
  applyHere: () => Promise<unknown>,
  reload: Slice[],
): Promise<{ queued: boolean }> {
  const queue = offlineQueue();
  // What an earlier visit left waiting must be known before deciding whether this command may go straight through.
  await queue.ensureLoaded();
  const key = newIdempotencyKey();
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (!offline && !queue.hasFor(cmd.orderId)) {
    try {
      await apiFetch(cmd.path, { method: "POST", body: cmd.body, idempotencyKey: key });
      await refresh(reload);
      return { queued: false };
    } catch (e) {
      if (!(e instanceof DomainError) || e.code !== "NETWORK_OFFLINE") throw e;
    }
  }
  await applyHere();
  const tenantId = getApiSession().tenantId;
  if (!tenantId) throw new DomainError("AUTH_REQUIRED");
  await queue.enqueue({ id: key, kind: cmd.kind, orderId: cmd.orderId, path: cmd.path, body: cmd.body, tenantId, branchId: currentBranchId(), summary: cmd.summary });
  return { queued: true };
}

export const posCommands = {
  async openShift(openingFloat) {
    const r = await apiFetch<{ id: string }>("/v1/shifts", { method: "POST", body: { branchId: currentBranchId(), openingFloat: baht(openingFloat) } });
    await refresh(["shifts"]);
    return r.id;
  },

  async cashMove(kind, amount, reason) {
    await apiFetch(`/v1/shifts/${openShiftId()}/cash-movements`, { method: "POST", body: { kind, amount: baht(amount), reason } });
    await refresh(["shifts"]);
  },

  async closeShift(counted) {
    const r = await apiFetch<{ expectedCash: string; countedCash: string; variance: string }>(`/v1/shifts/${openShiftId()}/close`, { method: "POST", body: { countedCash: baht(counted) } });
    await refresh(["shifts", "orders"]);
    return { expected: toSatang(r.expectedCash), counted: toSatang(r.countedCash), variance: toSatang(r.variance) };
  },

  async submitOrder(input) {
    const body = {
      id: input.id,
      branchId: currentBranchId(),
      channelId: input.channelId,
      tableId: input.tableId,
      guestCount: input.guestCount || undefined,
      note: input.note,
      fire: true,
      items: input.items.map((i) => ({ id: i.id, menuItemId: i.menuItemId, qty: i.qty, note: i.note, modifierOptionIds: i.modifierOptionIds })),
    };
    return sendOrQueue(
      { kind: "submitOrder", orderId: input.id, path: "/v1/orders", body, summary: `ส่งออเดอร์เข้าครัว · ${input.items.reduce((n, i) => n + i.qty, 0)} รายการ` },
      () => demoDataSource.submitOrder(input),
      ["orders", "tickets", "stock"],
    );
  },

  async applyDiscount(orderId, type, value, reason, approval) {
    // A fixed amount arrives in satang and goes out in baht; a percent goes as it is.
    await apiFetch(`/v1/orders/${orderId}/discount`, { method: "POST", body: { type, value: type === "amount" ? value / 100 : value, reason, approvalId: approval?.value } });
    await refresh(["orders"]);
  },

  async voidItem(orderId, itemId, reason, approval) {
    void orderId;
    await apiFetch(`/v1/order-items/${itemId}/void`, { method: "POST", body: { reason, approvalId: approval?.value } });
    await refresh(["orders", "tickets"]);
  },

  async voidOrder(orderId, reason, approval) {
    await apiFetch(`/v1/orders/${orderId}/void`, { method: "POST", body: { reason, approvalId: approval?.value } });
    await refresh(["orders", "tickets"]);
  },

  async payOrder(orderId, payments) {
    const body = { payments: payments.map((p) => ({ methodId: p.methodId, amount: baht(p.amount), tendered: p.tendered === undefined ? undefined : baht(p.tendered), reference: p.reference })) };
    const total = payments.reduce((n, p) => n + p.amount, 0);
    return sendOrQueue(
      { kind: "payOrder", orderId, path: `/v1/orders/${orderId}/pay`, body, summary: `รับเงิน ${formatBaht(total)}` },
      async () => {
        await demoDataSource.payOrder(orderId, payments);
        // The receipt number is the server's to give (per branch and month): the one the demo engine just made up must not be shown or printed.
        useSabai.getState().patch((d) => {
          const o = d.orders.find((x) => x.id === orderId);
          if (o) o.receiptNo = undefined;
        });
      },
      ["orders", "shifts", "stock"],
    );
  },

  async refundOrder(orderId, reason, restock, approval) {
    await apiFetch(`/v1/orders/${orderId}/refund`, { method: "POST", body: { reason, restock, approvalId: approval?.value } });
    await refresh(["orders", "shifts", "stock"]);
  },

  async setSoldOut(menuItemId, soldOut) {
    await apiFetch(`/v1/menu-items/${menuItemId}/availability`, { method: "POST", body: { branchId: currentBranchId(), available: !soldOut } });
    await refresh(["availability"]);
  },
} satisfies Partial<DataSource>;
