/**
 * API → `DemoState` for the data that changes during a shift (orders, shifts,
 * availability, ...). Same rules as `mappers.ts`: money becomes satang, ids stay
 * as they are, snake_case becomes camelCase. Per-unit costs stay in baht.
 */
import { addDays, profitWaterfall, toSatang, type MenuClass } from "@sabai/domain";
import type { ReportFilter, ReportSummary, TodayStats } from "./types";
import type { Bill, DayClose, ExpectedReceipt, Expense, MenuItem, Movement, Order, PurchaseOrder, Shift, StatementLine, StockCount, Ticket } from "../demo/types";

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

// ---------------------------------------------------------------------------
// Purchase orders — GET /v1/purchase-orders?detail=full
// ---------------------------------------------------------------------------
export interface PurchaseOrderApi {
  id: string;
  po_no: string;
  status: "draft" | "submitted" | "approved" | "sent" | "partially_received" | "received" | "cancelled";
  expected_date: string | null;
  total: string;
  created_at: string;
  branch_id: string;
  supplier_id: string;
  lines: { id: string; ingredient_id: string; pack_name: string; pack_qty: number; qty_packs: number; unit_price: string; received_packs: number }[];
}

export function mapPurchaseOrder(o: PurchaseOrderApi): PurchaseOrder {
  return {
    id: o.id,
    poNo: o.po_no,
    branchId: o.branch_id,
    supplierId: o.supplier_id,
    // Waiting to be approved is one state on screen, whether or not it was formally "submitted" first.
    status: o.status === "submitted" ? "draft" : o.status,
    createdAt: o.created_at,
    expectedDate: o.expected_date ?? undefined,
    lines: o.lines.map((l) => ({ id: l.id, ingredientId: l.ingredient_id, packName: l.pack_name, packQty: l.pack_qty, qtyPacks: l.qty_packs, unitPrice: toSatang(l.unit_price), receivedPacks: l.received_packs })),
    total: toSatang(o.total),
  };
}

// ---------------------------------------------------------------------------
// Finance — GET /v1/bills, /v1/expenses, /v1/days, /v1/reconciliation
// ---------------------------------------------------------------------------
export interface BillApi {
  id: string;
  internal_no: string;
  bill_no: string | null;
  bill_date: string;
  due_date: string;
  total: string;
  amount_paid: string;
  status: "open" | "partially_paid";
  supplier_id: string | null;
  source_id: string | null;
}

export function mapBill(b: BillApi): Bill {
  return {
    id: b.id,
    // A bill made by hand or from an expense may have no supplier; the screen shows it as unnamed.
    supplierId: b.supplier_id ?? "",
    billNo: b.bill_no ?? b.internal_no,
    date: b.bill_date,
    dueDate: b.due_date,
    total: toSatang(b.total),
    paid: toSatang(b.amount_paid),
    status: b.status,
    sourceId: b.source_id ?? undefined,
  };
}

export interface ExpenseApi {
  id: string;
  branch_id: string | null;
  expense_date: string;
  period_start: string | null;
  period_end: string | null;
  description: string;
  amount: string;
  paid_from: Expense["paidFrom"];
  /** The ledger account's fixed key: "rent", "salaries", ... or "other_expense". */
  account_key: string | null;
}

const EXPENSE_CATEGORIES = new Set<string>(["rent", "salaries", "utilities", "marketing", "supplies", "repairs"]);

export function mapExpense(e: ExpenseApi): Expense {
  return {
    id: e.id,
    branchId: e.branch_id ?? undefined,
    date: e.expense_date,
    category: e.account_key && EXPENSE_CATEGORIES.has(e.account_key) ? (e.account_key as Expense["category"]) : "other",
    description: e.description,
    amount: toSatang(e.amount),
    paidFrom: e.paid_from,
    periodStart: e.period_start ?? undefined,
    periodEnd: e.period_end ?? undefined,
  };
}

export interface ExpectedApi {
  id: string;
  branch_id: string;
  status: "open" | "partial";
  label: string;
  expected_date: string;
  expected_amount: string;
  source_type: ExpectedReceipt["sourceType"];
  payer: string;
}

export function mapExpected(e: ExpectedApi): ExpectedReceipt {
  return {
    id: e.id,
    branchId: e.branch_id,
    label: e.label,
    expectedDate: e.expected_date,
    amount: toSatang(e.expected_amount),
    sourceType: e.source_type,
    payer: e.payer,
    // Part-matched money is still waiting for the rest.
    status: "open",
  };
}

export interface StatementLineApi {
  id: string;
  txn_date: string;
  amount: string;
  description: string | null;
}

export function mapStatementLine(l: StatementLineApi, status: StatementLine["status"]): StatementLine {
  return { id: l.id, date: l.txn_date, amount: toSatang(l.amount), description: l.description ?? "", status };
}

export interface DayCloseApi {
  business_date: string;
  status: "closed" | "reopened";
  /** What the database wrote down when the day was closed: orders and money totals (baht). */
  summary: { orders: number; total: string | number; vat: string | number; gross_sales?: string | number; discounts?: string | number; service_charge?: string | number } | null;
  closed_at: string | null;
}

/**
 * A day that has been closed and not reopened. The list only carries the totals, so the
 * per-channel and per-method breakdown (which the demo keeps) is left empty rather than made up.
 */
export function mapDayClose(r: DayCloseApi, branchId: string): DayClose {
  const total = toSatang(r.summary?.total ?? 0);
  const vat = toSatang(r.summary?.vat ?? 0);
  return {
    branchId,
    businessDate: r.business_date,
    closedAt: r.closed_at ?? r.business_date,
    summary: { orders: r.summary?.orders ?? 0, total, netSales: total - vat, vat, byChannel: [], byMethod: [], cashVariance: 0 },
  };
}

// ---------------------------------------------------------------------------
// Reports — GET /v1/reports/summary and GET /v1/reports/today
// ---------------------------------------------------------------------------
/** Money is baht strings, shares are percents with one decimal; profit fields only come to people who may see profit. */
export interface ReportSummaryApi {
  totals: { orders: number; netSales: string; avgTicket: string; cost?: string; commission?: string; fees?: string; waste?: string; variance?: string; expenses?: string };
  waterfall?: { key: ReportSummary["waterfall"][number]["key"]; label: string; labelEn: string; value: string; running: string; kind: "start" | "minus" | "end"; pctOfSales: number; explain: string }[];
  days: { date: string; orders: number; netSales: string; profit?: string }[];
  hours: number[];
  branches: { id: string; name: string; orders: number; netSales: string; profit?: string }[];
  channels: { channelId: string; name: string; orders: number; netSales: string; avgTicket: string; shareOfSales: number; cost?: string; commission?: string; paymentFees?: string; contribution?: string; marginPct?: number; shareOfContribution?: number }[];
  items: { menuItemId: string; name: string; qty: number; sales: string; cost?: string; contributionPerItem?: string; mixPct?: number; class?: MenuClass }[];
}

const zeroWaterfall = (netSales: number) => profitWaterfall({ netSales, cogs: 0, waste: 0, stockVariance: 0, commission: 0, paymentFees: 0, expenses: 0 });

/** Every day of the range, with zeros for days nothing was sold — the trend chart expects them all. */
function daysOf(f: Pick<ReportFilter, "from" | "to">, rows: ReportSummaryApi["days"]): ReportSummary["days"] {
  const byDate = new Map(rows.map((d) => [d.date, d]));
  const out: ReportSummary["days"] = [];
  for (let d = f.from; d <= f.to; d = addDays(d, 1)) {
    const row = byDate.get(d);
    out.push({ date: d, netSales: row ? toSatang(row.netSales) : 0, contribution: row?.profit ? toSatang(row.profit) : 0, orders: row?.orders ?? 0 });
  }
  return out;
}

/** What the screen shows before anything has been sold, or before the first answer arrives. */
export function emptyReportSummary(f: Pick<ReportFilter, "from" | "to">): ReportSummary {
  return {
    totals: { orders: 0, netSales: 0, cost: 0, commission: 0, fees: 0, waste: 0, variance: 0, expenses: 0, avgTicket: 0 },
    waterfall: zeroWaterfall(0),
    channels: [],
    items: [],
    days: daysOf(f, []),
    hours: new Array(24).fill(0) as number[],
    branches: [],
  };
}

export function mapReportSummary(r: ReportSummaryApi, f: Pick<ReportFilter, "from" | "to">): ReportSummary {
  const sat = (v: string | undefined) => (v === undefined ? 0 : toSatang(v));
  const fraction = (percent: number | undefined) => (percent === undefined ? 0 : percent / 100);
  const netSales = sat(r.totals.netSales);
  return {
    totals: {
      orders: r.totals.orders,
      netSales,
      cost: sat(r.totals.cost),
      commission: sat(r.totals.commission),
      fees: sat(r.totals.fees),
      waste: sat(r.totals.waste),
      variance: sat(r.totals.variance),
      expenses: sat(r.totals.expenses),
      avgTicket: sat(r.totals.avgTicket),
    },
    // Without the right to see profit the server sends no costs; the screen does not draw this part for those people.
    waterfall: r.waterfall ? r.waterfall.map((w) => ({ ...w, value: toSatang(w.value), running: toSatang(w.running) })) : zeroWaterfall(netSales),
    channels: r.channels.map((c) => ({
      channelId: c.channelId,
      name: c.name,
      orders: c.orders,
      netSales: sat(c.netSales),
      cost: sat(c.cost),
      commission: sat(c.commission),
      paymentFees: sat(c.paymentFees),
      contribution: sat(c.contribution),
      marginPct: fraction(c.marginPct),
      avgTicket: sat(c.avgTicket),
      shareOfSales: fraction(c.shareOfSales),
      shareOfContribution: fraction(c.shareOfContribution),
    })),
    items: r.items.map((i) => ({
      menuItemId: i.menuItemId,
      name: i.name,
      qty: i.qty,
      sales: sat(i.sales),
      cost: sat(i.cost),
      contributionPerItem: sat(i.contributionPerItem),
      mixPct: fraction(i.mixPct),
      class: i.class ?? "plowhorse",
    })),
    days: daysOf(f, r.days),
    hours: r.hours,
    branches: r.branches.map((b) => ({ id: b.id, name: b.name, netSales: sat(b.netSales), orders: b.orders, contribution: sat(b.profit) })),
  };
}

export interface TodayStatsApi {
  today: string;
  sales: string;
  orders: number;
  avgTicket: string;
  keep: string;
  keepPct: number;
  lastWeekSales: string;
  lastWeekOrders: number;
  spark: string[];
  open: number;
}

export function mapTodayStats(t: TodayStatsApi): TodayStats {
  return {
    today: t.today,
    sales: toSatang(t.sales),
    orders: t.orders,
    avgTicket: toSatang(t.avgTicket),
    keep: toSatang(t.keep),
    keepPct: t.keepPct,
    lastWeekSales: toSatang(t.lastWeekSales),
    lastWeekOrders: t.lastWeekOrders,
    spark: t.spark.map(toSatang),
    open: t.open,
  };
}
