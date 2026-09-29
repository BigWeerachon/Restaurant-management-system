/**
 * API → `DemoState` for the data that changes during a shift (orders, shifts,
 * availability, ...). Same rules as `mappers.ts`: money becomes satang, ids stay
 * as they are, snake_case becomes camelCase. Per-unit costs stay in baht.
 */
import { toSatang } from "@sabai/domain";
import type { MenuItem, Movement, Order, Shift, StockCount, Ticket } from "../demo/types";

// ---------------------------------------------------------------------------
// Orders — GET /v1/orders?detail=full and GET /v1/orders/{id}
// ---------------------------------------------------------------------------
export interface OrderApi {
  id: string;
  orderNo: string;
  receiptNo: string | null;
  status: Order["status"];
  businessDate: string;
  branchId: string;
  channelId: string;
  tableId: string | null;
  shiftId: string | null;
  guestCount: number | null;
  note: string | null;
  openedBy: string | null;
  openedAt: string;
  paidAt: string | null;
  discount: { type: "percent" | "amount"; value: number; reason: string | null } | null;
  commissionRate: number;
  commissionAmount: string;
  commissionVat: string;
  costTotal: number | null;
  itemsTotal: string;
  discountTotal: string;
  serviceCharge: string;
  vatAmount: string;
  rounding: string;
  total: string;
  items: {
    id: string;
    menu_item_id: string;
    name: string;
    qty: string | number;
    unit_price: string;
    cost_amount: number | null;
    note: string | null;
    status: Order["items"][number]["status"];
    void_reason: string | null;
    modifiers: { id: string; name: string; price_delta: string }[];
  }[];
  payments: {
    id: string;
    method_id: string;
    kind: "payment" | "refund";
    amount: string;
    tendered: string | null;
    change_given: string;
    fee_amount: string;
    reference: string | null;
    created_at: string;
  }[];
}

export function mapOrder(o: OrderApi, menuItems: Pick<MenuItem, "id" | "emoji">[]): Order {
  const emoji = new Map(menuItems.map((m) => [m.id, m.emoji]));
  const total = toSatang(o.total);
  const vatAmount = toSatang(o.vatAmount);
  const rounding = toSatang(o.rounding);
  return {
    id: o.id,
    branchId: o.branchId,
    channelId: o.channelId,
    tableId: o.tableId ?? undefined,
    orderNo: o.orderNo,
    receiptNo: o.receiptNo ?? undefined,
    status: o.status,
    businessDate: o.businessDate,
    openedAt: o.openedAt,
    paidAt: o.paidAt ?? undefined,
    openedBy: o.openedBy ?? undefined,
    guestCount: o.guestCount ?? undefined,
    note: o.note ?? undefined,
    items: o.items.map((i) => ({
      id: i.id,
      menuItemId: i.menu_item_id,
      name: i.name,
      emoji: emoji.get(i.menu_item_id) ?? "🍽️",
      qty: Number(i.qty),
      unitPrice: toSatang(i.unit_price),
      modifiers: i.modifiers.map((m) => ({ id: m.id, name: m.name, priceDelta: toSatang(m.price_delta) })),
      note: i.note ?? undefined,
      status: i.status,
      voidReason: i.void_reason ?? undefined,
      cost: i.cost_amount ?? undefined,
    })),
    // A fixed amount is baht in the API and satang in the client, like every other amount; a percent is left alone.
    discount: o.discount ? { type: o.discount.type, value: o.discount.type === "amount" ? toSatang(o.discount.value) : o.discount.value, reason: o.discount.reason ?? "" } : undefined,
    payments: o.payments.map((p) => ({
      id: p.id,
      methodId: p.method_id,
      kind: p.kind,
      amount: toSatang(p.amount),
      tendered: p.tendered === null ? undefined : toSatang(p.tendered),
      change: toSatang(p.change_given),
      fee: toSatang(p.fee_amount),
      reference: p.reference ?? undefined,
      at: p.created_at,
    })),
    totals: {
      itemsTotal: toSatang(o.itemsTotal),
      discountTotal: toSatang(o.discountTotal),
      serviceCharge: toSatang(o.serviceCharge),
      vatAmount,
      rounding,
      total,
      commission: toSatang(o.commissionAmount),
      commissionVat: toSatang(o.commissionVat),
      // Same definition as calculateOrderTotals: what the owner earned, without VAT or cash rounding.
      netSales: total - vatAmount - rounding,
    },
    commissionRate: o.commissionRate,
    cost: o.costTotal ?? undefined,
    shiftId: o.shiftId ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Stock — GET /v1/stock, GET /v1/stock-movements, GET /v1/stock-counts[/{id}]
// ---------------------------------------------------------------------------
export interface StockRowApi {
  ingredient_id: string;
  qty_on_hand: number;
  /** Only sent to people who may see costs. */
  unit_cost?: number;
}

/** `balances` keeps quantity and average cost (฿ per base unit) per branch and ingredient. */
export function mapBalances(rows: StockRowApi[], branchId: string): Record<string, { qty: number; avgCost: number }> {
  return Object.fromEntries(rows.map((r) => [`${branchId}:${r.ingredient_id}`, { qty: r.qty_on_hand, avgCost: r.unit_cost ?? 0 }]));
}

export interface MovementApi {
  id: string;
  ingredient_id: string;
  qty: number;
  unit_cost: number;
  reason: Movement["reason"];
  reason_code: string | null;
  business_date: string;
  occurred_at: string;
  note: string | null;
  /** The membership that recorded it; empty for movements the system made (a sale's usage, say). */
  created_by?: string | null;
}

export function mapMovement(m: MovementApi, branchId: string): Movement {
  return {
    id: m.id,
    branchId,
    ingredientId: m.ingredient_id,
    qty: m.qty,
    unitCost: m.unit_cost,
    reason: m.reason,
    reasonCode: m.reason_code ?? undefined,
    at: m.occurred_at,
    by: m.created_by ?? undefined,
    businessDate: m.business_date,
    note: m.note ?? undefined,
  };
}

export interface CountRowApi {
  id: string;
  status: "in_progress" | "submitted" | "approved" | "cancelled";
  started_at: string;
  submitted_at: string | null;
  approved_at: string | null;
}

export interface CountDetailApi {
  id: string;
  countNo: string;
  status: CountRowApi["status"];
  blind: boolean;
  /** `expected` and `unitCost` are left out while a blind count is in progress, and for people who may not adjust stock. */
  lines: { ingredientId: string; counted: number | null; expected?: number | null; unitCost?: number }[];
}

export function mapCount(detail: CountDetailApi, row: CountRowApi, branchId: string): StockCount {
  return {
    id: detail.id,
    branchId,
    countNo: detail.countNo,
    // The screen has no cancelled state; cancelled counts are never loaded.
    status: detail.status === "cancelled" ? "approved" : detail.status,
    blind: detail.blind,
    startedAt: row.started_at,
    submittedAt: row.submitted_at ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    lines: detail.lines.map((l) => ({ ingredientId: l.ingredientId, counted: l.counted, expected: l.expected ?? undefined, unitCost: l.unitCost })),
  };
}

// ---------------------------------------------------------------------------
// Kitchen tickets — GET /v1/kds/tickets
// ---------------------------------------------------------------------------
export interface TicketApi {
  id: string;
  station_id: string;
  ticket_no: string;
  status: "new" | "in_progress" | "ready" | "served" | "cancelled";
  fired_at: string;
  started_at: string | null;
  ready_at: string | null;
  order_id: string;
  channel: string;
  channel_kind: Ticket["channelKind"];
  table_name: string | null;
  items: { id: string; order_item_id: string; name: string; qty: string | number; modifiers: string | null; note: string | null; status: "pending" | "done" | "voided" }[];
}

export function mapTicket(t: TicketApi, branchId: string): Ticket {
  return {
    id: t.id,
    branchId,
    orderId: t.order_id,
    stationId: t.station_id,
    ticketNo: t.ticket_no,
    // The screen has no "served" state: a served ticket is just a finished one.
    status: t.status === "served" ? "ready" : t.status,
    firedAt: t.fired_at,
    startedAt: t.started_at ?? undefined,
    readyAt: t.ready_at ?? undefined,
    items: t.items.map((i) => ({ id: i.id, orderItemId: i.order_item_id, name: i.name, qty: Number(i.qty), modifiers: i.modifiers ?? "", note: i.note ?? undefined, status: i.status })),
    channelName: t.channel,
    channelKind: t.channel_kind,
    tableName: t.table_name ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Shifts — GET /v1/shifts/current and GET /v1/shifts
// ---------------------------------------------------------------------------
export interface CurrentShiftApi {
  id: string;
  opened_at: string;
  opened_by: string | null;
  opening_float: string;
  business_date: string;
  expected_cash: string;
  cash_movements: { id: string; kind: "pay_in" | "pay_out" | "drop"; amount: string; reason: string; created_at: string }[];
}

export interface ShiftRowApi {
  id: string;
  business_date: string;
  status: "open" | "closed";
  opening_float: string;
  expected_cash: string | null;
  counted_cash: string | null;
  cash_variance: string | null;
  opened_at: string;
  closed_at: string | null;
  opened_by: string | null;
}

/** The open shift, with the server's own figure for the cash that should be in the drawer. */
export function mapCurrentShift(s: CurrentShiftApi, branchId: string): Shift {
  return {
    id: s.id,
    branchId,
    openedBy: s.opened_by ?? "",
    openedAt: s.opened_at,
    openingFloat: toSatang(s.opening_float),
    status: "open",
    expectedCash: toSatang(s.expected_cash),
    // A drop is cash leaving the drawer, like a pay-out.
    cashMoves: s.cash_movements.map((m) => ({ id: m.id, kind: m.kind === "pay_in" ? "pay_in" : "pay_out", amount: toSatang(m.amount), reason: m.reason, at: m.created_at })),
    businessDate: s.business_date,
  };
}

export function mapClosedShift(s: ShiftRowApi, branchId: string): Shift {
  return {
    id: s.id,
    branchId,
    openedBy: s.opened_by ?? "",
    openedAt: s.opened_at,
    openingFloat: toSatang(s.opening_float),
    status: "closed",
    closedAt: s.closed_at ?? undefined,
    countedCash: s.counted_cash === null ? undefined : toSatang(s.counted_cash),
    expectedCash: s.expected_cash === null ? undefined : toSatang(s.expected_cash),
    variance: s.cash_variance === null ? undefined : toSatang(s.cash_variance),
    cashMoves: [],
    businessDate: s.business_date,
  };
}
