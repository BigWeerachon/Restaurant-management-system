import type { OrderApi, TicketApi } from "./live-mappers";

// Shape of one ticket in GET /v1/kds/tickets (asserted against real Postgres in the API tests).
export function ticketApi(overrides: Partial<TicketApi> = {}): TicketApi {
  return {
    id: "kt-1",
    station_id: "st-bar",
    ticket_no: "B-004",
    status: "new",
    fired_at: "2026-09-29T03:00:00.000Z",
    started_at: null,
    ready_at: null,
    order_id: "o-1",
    channel: "ทานที่ร้าน",
    channel_kind: "dine_in",
    table_name: "A3",
    items: [
      { id: "kti-1", order_item_id: "oi-1", name: "ลาเต้เย็น", qty: "2.000", modifiers: "หวานน้อย, เพิ่มช็อต", note: null, status: "pending" },
      { id: "kti-2", order_item_id: "oi-2", name: "มัทฉะลาเต้", qty: 1, modifiers: null, note: "แก้วเล็ก", status: "done" },
    ],
    ...overrides,
  };
}

// Shapes copied from GET /v1/orders?detail=full (asserted against real Postgres in the API tests).
export function orderApi(overrides: Partial<OrderApi> = {}): OrderApi {
  return {
    id: "o-1",
    orderNo: "003",
    receiptNo: null,
    status: "open",
    businessDate: "2026-09-29",
    branchId: "br-1",
    channelId: "ch-1",
    tableId: "t-1",
    shiftId: "sh-1",
    guestCount: 2,
    note: null,
    openedBy: "m-1",
    openedAt: "2026-09-29T03:00:00.000Z",
    paidAt: null,
    discount: null,
    commissionRate: 0,
    commissionAmount: "0.00",
    commissionVat: "0.00",
    costTotal: null,
    itemsTotal: "185.00",
    discountTotal: "0.00",
    serviceCharge: "0.00",
    vatAmount: "12.10",
    rounding: "0.00",
    total: "185.00",
    items: [
      {
        id: "oi-1",
        menu_item_id: "mi-latte",
        name: "ลาเต้เย็น",
        qty: "2.000",
        unit_price: "65.00",
        cost_amount: 16.2,
        note: "ไม่หวาน",
        status: "sent",
        void_reason: null,
        modifiers: [{ id: "mo-1", name: "เพิ่มช็อต", price_delta: "15.00" }],
      },
      { id: "oi-2", menu_item_id: "mi-gone", name: "เมนูที่ถูกลบ", qty: 1, unit_price: "10.00", cost_amount: null, note: null, status: "voided", void_reason: "สั่งผิด", modifiers: [] },
    ],
    payments: [],
    ...overrides,
  };
}
