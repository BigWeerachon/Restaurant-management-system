/** POS commands for the API adapter: shifts, orders, payments, availability. */
import { toSatang } from "@sabai/domain";
import { DomainError, openShiftOf } from "../demo/engine";
import { useSabai } from "../demo/store";
import { baht, currentBranchId, refresh } from "./http-context";
import { apiFetch } from "./http-client";
import type { DataSource } from "./types";

function openShiftId(): string {
  const shift = openShiftOf(useSabai.getState().db, currentBranchId());
  if (!shift) throw new DomainError("SHIFT_NOT_OPEN");
  return shift.id;
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
    await apiFetch("/v1/orders", {
      method: "POST",
      body: {
        id: input.id,
        branchId: currentBranchId(),
        channelId: input.channelId,
        tableId: input.tableId,
        guestCount: input.guestCount || undefined,
        note: input.note,
        fire: true,
        items: input.items.map((i) => ({ id: i.id, menuItemId: i.menuItemId, qty: i.qty, note: i.note, modifierOptionIds: i.modifierOptionIds })),
      },
    });
    await refresh(["orders", "tickets", "stock"]);
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
    await apiFetch(`/v1/orders/${orderId}/pay`, {
      method: "POST",
      body: { payments: payments.map((p) => ({ methodId: p.methodId, amount: baht(p.amount), tendered: p.tendered === undefined ? undefined : baht(p.tendered), reference: p.reference })) },
    });
    await refresh(["orders", "shifts", "stock"]);
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
