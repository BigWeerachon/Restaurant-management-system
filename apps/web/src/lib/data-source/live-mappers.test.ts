import { describe, expect, it } from "vitest";
import { orderApi, ticketApi } from "./fixtures";
import { describeActivity, emptyReportSummary, mapBalances, mapActivity, mapBill, mapClosedShift, mapCount, mapCurrentShift, mapDayClose, mapExpected, mapExpense, mapMovement, mapOrder, mapPurchaseOrder, mapReportSummary, mapStatementLine, mapTicket, mapTodayStats, type ReportSummaryApi } from "./live-mappers";

const menu = [{ id: "mi-latte", emoji: "🥤" }];

describe("mapOrder", () => {
  it("turns an order into the client's Order with money in satang and quantities as numbers", () => {
    const o = mapOrder(orderApi(), menu);
    expect(o).toMatchObject({ id: "o-1", orderNo: "003", status: "open", tableId: "t-1", shiftId: "sh-1", guestCount: 2, openedBy: "m-1", receiptNo: undefined, paidAt: undefined, cost: undefined });
    expect(o.items[0]).toMatchObject({ qty: 2, unitPrice: 6500, note: "ไม่หวาน", status: "sent", cost: 16.2, emoji: "🥤" });
    expect(o.items[0]!.modifiers).toEqual([{ id: "mo-1", name: "เพิ่มช็อต", priceDelta: 1500 }]);
    expect(o.items[1]).toMatchObject({ status: "voided", voidReason: "สั่งผิด", emoji: "🍽️", cost: undefined });
    expect(o.totals).toMatchObject({ itemsTotal: 18500, vatAmount: 1210, total: 18500 });
  });

  it("computes net sales like the domain does: total without VAT or cash rounding", () => {
    const o = mapOrder(orderApi({ total: "185.25", vatAmount: "12.11", rounding: "0.25" }), menu);
    expect(o.totals.netSales).toBe(18525 - 1211 - 25);
  });

  it("keeps a percent discount as it is and converts a fixed amount from baht to satang", () => {
    expect(mapOrder(orderApi({ discount: { type: "percent", value: 12.5, reason: "โปรเปิดร้าน" } }), menu).discount).toEqual({ type: "percent", value: 12.5, reason: "โปรเปิดร้าน" });
    expect(mapOrder(orderApi({ discount: { type: "amount", value: 20, reason: null } }), menu).discount).toEqual({ type: "amount", value: 2000, reason: "" });
    expect(mapOrder(orderApi(), menu).discount).toBeUndefined();
  });

  it("maps a paid order's payments, change, fees and commission snapshot", () => {
    const o = mapOrder(
      orderApi({
        status: "paid",
        receiptNo: "HQ-2026-00001",
        paidAt: "2026-09-29T03:20:00.000Z",
        commissionRate: 0.3,
        commissionAmount: "55.50",
        commissionVat: "3.89",
        costTotal: 61.4,
        payments: [{ id: "p-1", method_id: "pm-cash", kind: "payment", amount: "185.00", tendered: "500.00", change_given: "315.00", fee_amount: "0.00", reference: null, created_at: "2026-09-29T03:20:00.000Z" }],
      }),
      menu,
    );
    expect(o).toMatchObject({ status: "paid", receiptNo: "HQ-2026-00001", commissionRate: 0.3, cost: 61.4 });
    expect(o.totals).toMatchObject({ commission: 5550, commissionVat: 389 });
    expect(o.payments[0]).toEqual({ id: "p-1", methodId: "pm-cash", kind: "payment", amount: 18500, tendered: 50000, change: 31500, fee: 0, reference: undefined, at: "2026-09-29T03:20:00.000Z" });
  });
});

describe("mapTicket", () => {
  it("keeps both ids of each ticket line: its own (to toggle it) and the order line it belongs to", () => {
    const t = mapTicket(ticketApi(), "br-1");
    expect(t).toMatchObject({ id: "kt-1", branchId: "br-1", orderId: "o-1", stationId: "st-bar", ticketNo: "B-004", status: "new", startedAt: undefined, readyAt: undefined, channelName: "ทานที่ร้าน", channelKind: "dine_in", tableName: "A3" });
    expect(t.items[0]).toEqual({ id: "kti-1", orderItemId: "oi-1", name: "ลาเต้เย็น", qty: 2, modifiers: "หวานน้อย, เพิ่มช็อต", note: undefined, status: "pending" });
    expect(t.items[1]).toMatchObject({ id: "kti-2", orderItemId: "oi-2", qty: 1, modifiers: "", note: "แก้วเล็ก", status: "done" });
  });

  it("carries the times and treats a served ticket as a finished one", () => {
    const t = mapTicket(ticketApi({ status: "served", started_at: "2026-09-29T03:01:00.000Z", ready_at: "2026-09-29T03:05:00.000Z", table_name: null }), "br-1");
    expect(t).toMatchObject({ status: "ready", startedAt: "2026-09-29T03:01:00.000Z", readyAt: "2026-09-29T03:05:00.000Z", tableName: undefined });
  });
});

describe("shifts", () => {
  it("maps the open shift with the server's expected cash and treats a drop as cash going out", () => {
    const s = mapCurrentShift(
      {
        id: "sh-1",
        opened_at: "2026-09-29T02:00:00.000Z",
        opened_by: "m-1",
        opening_float: "1000.00",
        business_date: "2026-09-29",
        expected_cash: "1185.00",
        cash_movements: [
          { id: "cm-1", kind: "pay_in", amount: "200.00", reason: "ทอนเพิ่ม", created_at: "2026-09-29T04:00:00.000Z" },
          { id: "cm-2", kind: "drop", amount: "500.00", reason: "นำฝาก", created_at: "2026-09-29T05:00:00.000Z" },
        ],
      },
      "br-1",
    );
    expect(s).toMatchObject({ id: "sh-1", branchId: "br-1", status: "open", openingFloat: 100000, expectedCash: 118500, openedBy: "m-1", businessDate: "2026-09-29" });
    expect(s.cashMoves.map((m) => [m.kind, m.amount])).toEqual([
      ["pay_in", 20000],
      ["pay_out", 50000],
    ]);
  });

  it("maps a closed shift with what was counted and the difference", () => {
    const s = mapClosedShift(
      { id: "sh-0", business_date: "2026-09-28", status: "closed", opening_float: "1000.00", expected_cash: "3200.00", counted_cash: "3190.00", cash_variance: "-10.00", opened_at: "2026-09-28T02:00:00.000Z", closed_at: "2026-09-28T14:00:00.000Z", opened_by: null },
      "br-1",
    );
    expect(s).toMatchObject({ status: "closed", countedCash: 319000, expectedCash: 320000, variance: -1000, openedBy: "", closedAt: "2026-09-28T14:00:00.000Z" });
    expect(s.cashMoves).toEqual([]);
  });
});

describe("stock", () => {
  it("keys balances by branch and ingredient, with the average cost in baht per base unit", () => {
    expect(
      mapBalances(
        [
          { ingredient_id: "ing-1", qty_on_hand: 2500, unit_cost: 0.032 },
          // A person who may not see costs gets no unit_cost: it must not become a made-up price.
          { ingredient_id: "ing-2", qty_on_hand: -30 },
        ],
        "br-1",
      ),
    ).toEqual({ "br-1:ing-1": { qty: 2500, avgCost: 0.032 }, "br-1:ing-2": { qty: -30, avgCost: 0 } });
    // The server counts the week's usage (the screen holds only the latest movements): kept when sent, never invented when not.
    expect(mapBalances([{ ingredient_id: "ing-1", qty_on_hand: 900, usage_7d: 630 }], "br-1")).toEqual({ "br-1:ing-1": { qty: 900, avgCost: 0, usage7d: 630 } });
    expect(mapBalances([{ ingredient_id: "ing-1", qty_on_hand: 900, usage_7d: 0 }], "br-1")["br-1:ing-1"]).toHaveProperty("usage7d", 0);
  });

  it("maps a movement with its own cost per unit and the reason code, if any", () => {
    const m = mapMovement({ id: "mv-1", ingredient_id: "ing-1", qty: -120, unit_cost: 0.025, reason: "waste", reason_code: "spoiled", business_date: "2026-09-29", occurred_at: "2026-09-29T03:00:00.000Z", note: null, created_by: "m-1" }, "br-1");
    expect(m).toEqual({ id: "mv-1", branchId: "br-1", ingredientId: "ing-1", qty: -120, unitCost: 0.025, reason: "waste", reasonCode: "spoiled", at: "2026-09-29T03:00:00.000Z", by: "m-1", businessDate: "2026-09-29", note: undefined });
  });
});

describe("mapCount", () => {
  const row = { id: "c-1", status: "in_progress" as const, started_at: "2026-09-29T02:00:00.000Z", submitted_at: null, approved_at: null };

  it("keeps expected quantities out of a blind count that is still being counted", () => {
    const c = mapCount({ id: "c-1", countNo: "CNT-0007", status: "in_progress", blind: true, lines: [{ ingredientId: "ing-1", counted: null }, { ingredientId: "ing-2", counted: 900 }] }, row, "br-1");
    expect(c).toMatchObject({ id: "c-1", branchId: "br-1", countNo: "CNT-0007", status: "in_progress", blind: true, startedAt: row.started_at });
    expect(c.lines).toEqual([
      { ingredientId: "ing-1", counted: null, expected: undefined, unitCost: undefined },
      { ingredientId: "ing-2", counted: 900, expected: undefined, unitCost: undefined },
    ]);
  });

  it("carries expected quantities and costs once the count is submitted, and its times", () => {
    const c = mapCount(
      { id: "c-1", countNo: "CNT-0007", status: "submitted", blind: true, lines: [{ ingredientId: "ing-1", counted: 800, expected: 1000, unitCost: 0.03 }] },
      { ...row, status: "submitted", submitted_at: "2026-09-29T03:00:00.000Z" },
      "br-1",
    );
    expect(c.status).toBe("submitted");
    expect(c.submittedAt).toBe("2026-09-29T03:00:00.000Z");
    expect(c.lines[0]).toEqual({ ingredientId: "ing-1", counted: 800, expected: 1000, unitCost: 0.03 });
  });
});

describe("mapPurchaseOrder", () => {
  const api = {
    id: "po-1",
    po_no: "PO2609-0001",
    status: "sent" as const,
    expected_date: "2026-09-30",
    total: "500.00",
    created_at: "2026-09-29T03:00:00.000Z",
    branch_id: "br-1",
    supplier_id: "su-1",
    lines: [{ id: "pol-1", ingredient_id: "ing-milk", pack_name: "ขวด 2 ลิตร", pack_qty: 2000, qty_packs: 5, unit_price: "100.00", received_packs: 2 }],
  };

  it("keeps the order's lines with their own ids, prices in satang and how much has arrived", () => {
    expect(mapPurchaseOrder(api)).toEqual({
      id: "po-1",
      poNo: "PO2609-0001",
      branchId: "br-1",
      supplierId: "su-1",
      status: "sent",
      createdAt: "2026-09-29T03:00:00.000Z",
      expectedDate: "2026-09-30",
      total: 50000,
      lines: [{ id: "pol-1", ingredientId: "ing-milk", packName: "ขวด 2 ลิตร", packQty: 2000, qtyPacks: 5, unitPrice: 10000, receivedPacks: 2 }],
    });
  });

  it("shows an order waiting for approval the same way whether or not it was formally submitted", () => {
    expect(mapPurchaseOrder({ ...api, status: "submitted" }).status).toBe("draft");
    expect(mapPurchaseOrder({ ...api, status: "draft" }).status).toBe("draft");
    expect(mapPurchaseOrder({ ...api, expected_date: null }).expectedDate).toBeUndefined();
  });
});

describe("finance mappers", () => {
  it("maps a bill to satang, using the internal number when the supplier gave none and leaving a supplier-less bill unnamed", () => {
    expect(mapBill({ id: "b-1", internal_no: "BILL-0001", bill_no: "INV-77", bill_date: "2026-09-20", due_date: "2026-10-05", total: "1500.50", amount_paid: "500.00", status: "partially_paid", supplier_id: "su-1", source_id: "gr-1" })).toEqual({
      id: "b-1",
      supplierId: "su-1",
      billNo: "INV-77",
      date: "2026-09-20",
      dueDate: "2026-10-05",
      total: 150050,
      paid: 50000,
      status: "partially_paid",
      sourceId: "gr-1",
    });
    const manual = mapBill({ id: "b-2", internal_no: "BILL-0002", bill_no: null, bill_date: "2026-09-20", due_date: "2026-09-21", total: "10.00", amount_paid: "0.00", status: "open", supplier_id: null, source_id: null });
    expect(manual).toMatchObject({ billNo: "BILL-0002", supplierId: "", sourceId: undefined });
  });

  it("gives an expense its category from the ledger account's key, and 'other' for anything unfamiliar", () => {
    const row = { id: "e-1", branch_id: "br-1", expense_date: "2026-09-29", period_start: "2026-09-01", period_end: "2026-09-30", description: "ค่าเช่า", amount: "30000.00", paid_from: "bank" as const, account_key: "rent" };
    expect(mapExpense(row)).toEqual({ id: "e-1", branchId: "br-1", date: "2026-09-29", category: "rent", description: "ค่าเช่า", amount: 3000000, paidFrom: "bank", periodStart: "2026-09-01", periodEnd: "2026-09-30" });
    expect(mapExpense({ ...row, account_key: "other_expense" }).category).toBe("other");
    expect(mapExpense({ ...row, account_key: "cost_of_goods" }).category).toBe("other");
    expect(mapExpense({ ...row, account_key: null, branch_id: null, period_start: null, period_end: null })).toMatchObject({ category: "other", branchId: undefined, periodStart: undefined });
  });

  it("maps money still expected, treating part-matched money as still open", () => {
    expect(mapExpected({ id: "x-1", branch_id: "br-1", status: "partial", label: "บัตร 28/09", expected_date: "2026-09-30", expected_amount: "480.00", source_type: "card_batch", payer: "acc-1" })).toEqual({
      id: "x-1",
      branchId: "br-1",
      label: "บัตร 28/09",
      expectedDate: "2026-09-30",
      amount: 48000,
      sourceType: "card_batch",
      payer: "acc-1",
      status: "open",
    });
  });

  it("maps bank lines with the status they were listed under and no missing text", () => {
    expect(mapStatementLine({ id: "l-1", txn_date: "2026-09-30", amount: "480.00", description: null }, "unmatched")).toEqual({ id: "l-1", date: "2026-09-30", amount: 48000, description: "", status: "unmatched" });
    expect(mapStatementLine({ id: "l-2", txn_date: "2026-09-30", amount: "-25.50", description: "ค่าธรรมเนียม" }, "matched")).toMatchObject({ amount: -2550, status: "matched" });
  });

  it("maps a closed day from its totals only — the breakdown is left empty, not invented", () => {
    const c = mapDayClose({ business_date: "2026-09-28", status: "closed", closed_at: "2026-09-29T02:00:00.000Z", summary: { orders: 12, total: "3210.00", vat: "210.00" } }, "br-1");
    expect(c).toEqual({ branchId: "br-1", businessDate: "2026-09-28", closedAt: "2026-09-29T02:00:00.000Z", summary: { orders: 12, total: 321000, netSales: 300000, vat: 21000, byChannel: [], byMethod: [], cashVariance: 0 } });
    // A row with no summary yet still maps.
    expect(mapDayClose({ business_date: "2026-09-27", status: "closed", closed_at: null, summary: null }, "br-1").summary.total).toBe(0);
  });
});

describe("mapReportSummary", () => {
  const waterfall = [
    { key: "net_sales" as const, label: "ยอดขายสุทธิ", labelEn: "Net sales", value: "1000.00", running: "1000.00", kind: "start" as const, pctOfSales: 1, explain: "" },
    { key: "cogs" as const, label: "ต้นทุนวัตถุดิบ", labelEn: "Ingredients", value: "-300.00", running: "700.00", kind: "minus" as const, pctOfSales: 0.3, explain: "" },
    { key: "profit" as const, label: "เหลือจริง", labelEn: "Profit", value: "700.00", running: "700.00", kind: "end" as const, pctOfSales: 0.7, explain: "" },
  ];
  const full: ReportSummaryApi = {
    totals: { orders: 10, netSales: "1000.00", avgTicket: "100.00", cost: "300.00", commission: "50.50", fees: "10.00", waste: "20.00", variance: "5.00", expenses: "100.00" },
    waterfall,
    days: [
      { date: "2026-09-27", orders: 4, netSales: "400.00", profit: "250.00" },
      { date: "2026-09-29", orders: 6, netSales: "600.00", profit: "450.00" },
    ],
    hours: new Array(24).fill(0),
    branches: [{ id: "br-1", name: "อารีย์", orders: 10, netSales: "1000.00", profit: "700.00" }],
    channels: [{ channelId: "ch-1", name: "ทานที่ร้าน", orders: 10, netSales: "1000.00", avgTicket: "100.00", shareOfSales: 100, cost: "300.00", commission: "50.50", paymentFees: "10.00", contribution: "639.50", marginPct: 63.9, shareOfContribution: 100 }],
    items: [{ menuItemId: "mi-1", name: "ลาเต้เย็น", qty: 20, sales: "1300.00", cost: "324.00", contributionPerItem: "48.80", mixPct: 45.5, class: "star" }],
  };
  const range = { from: "2026-09-27", to: "2026-09-29" };

  it("turns baht into satang and percents into fractions, so the screen gets exactly what the demo's report gives it", () => {
    const r = mapReportSummary(full, range);
    expect(r.totals).toEqual({ orders: 10, netSales: 100000, avgTicket: 10000, cost: 30000, commission: 5050, fees: 1000, waste: 2000, variance: 500, expenses: 10000 });
    expect(r.waterfall.map((w) => [w.key, w.value, w.running, w.kind])).toEqual([["net_sales", 100000, 100000, "start"], ["cogs", -30000, 70000, "minus"], ["profit", 70000, 70000, "end"]]);
    expect(r.channels[0]).toEqual({ channelId: "ch-1", name: "ทานที่ร้าน", orders: 10, netSales: 100000, cost: 30000, commission: 5050, paymentFees: 1000, contribution: 63950, marginPct: 0.639, avgTicket: 10000, shareOfSales: 1, shareOfContribution: 1 });
    expect(r.items[0]).toEqual({ menuItemId: "mi-1", name: "ลาเต้เย็น", qty: 20, sales: 130000, cost: 32400, contributionPerItem: 4880, mixPct: 0.455, class: "star" });
    expect(r.branches[0]).toEqual({ id: "br-1", name: "อารีย์", netSales: 100000, orders: 10, contribution: 70000 });
  });

  it("gives every day of the range, with zeros for the days nothing was sold", () => {
    const r = mapReportSummary(full, range);
    expect(r.days).toEqual([
      { date: "2026-09-27", netSales: 40000, contribution: 25000, orders: 4 },
      { date: "2026-09-28", netSales: 0, contribution: 0, orders: 0 },
      { date: "2026-09-29", netSales: 60000, contribution: 45000, orders: 6 },
    ]);
  });

  it("copes with a report that has no profit figures, as the server sends to people who may not see profit", () => {
    const { waterfall: _w, ...rest } = full;
    const r = mapReportSummary(
      {
        ...rest,
        totals: { orders: 10, netSales: "1000.00", avgTicket: "100.00" },
        days: [{ date: "2026-09-29", orders: 6, netSales: "600.00" }],
        branches: [{ id: "br-1", name: "อารีย์", orders: 10, netSales: "1000.00" }],
        channels: [{ channelId: "ch-1", name: "ทานที่ร้าน", orders: 10, netSales: "1000.00", avgTicket: "100.00", shareOfSales: 100 }],
        items: [{ menuItemId: "mi-1", name: "ลาเต้เย็น", qty: 20, sales: "1300.00" }],
      },
      range,
    );
    expect(r.totals).toMatchObject({ netSales: 100000, cost: 0, expenses: 0 });
    // Never undefined: the screen reads the last step of the waterfall without checking.
    expect(r.waterfall.at(-1)!.key).toBe("profit");
    expect(r.waterfall[0]).toMatchObject({ key: "net_sales", value: 100000 });
    expect(r.channels[0]).toMatchObject({ cost: 0, contribution: 0, marginPct: 0, shareOfSales: 1 });
    expect(r.items[0]).toMatchObject({ contributionPerItem: 0, mixPct: 0 });
    expect(r.days.find((d) => d.date === "2026-09-29")).toMatchObject({ netSales: 60000, contribution: 0 });
  });

  it("has an empty report for the moment before the first answer, with the whole range and 24 hours", () => {
    const r = emptyReportSummary({ from: "2026-09-29", to: "2026-09-29" });
    expect(r.totals.orders).toBe(0);
    expect(r.days).toEqual([{ date: "2026-09-29", netSales: 0, contribution: 0, orders: 0 }]);
    expect(r.hours).toHaveLength(24);
    expect(r.waterfall.at(-1)!.key).toBe("profit");
  });
});

describe("mapTodayStats", () => {
  it("turns today's figures into satang and keeps the share as a fraction", () => {
    expect(mapTodayStats({ today: "2026-09-29", sales: "1234.50", orders: 12, avgTicket: "102.88", keep: "500.00", keepPct: 0.412, lastWeekSales: "1000.00", lastWeekOrders: 10, spark: ["100.00", "0.00", "1234.50"], open: 2 })).toEqual({
      today: "2026-09-29",
      sales: 123450,
      orders: 12,
      avgTicket: 10288,
      keep: 50000,
      keepPct: 0.412,
      lastWeekSales: 100000,
      lastWeekOrders: 10,
      spark: [10000, 0, 123450],
      open: 2,
    });
  });
});

describe("the activity feed", () => {
  const ev = (type: string, payload: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    id: `ev-${type}`,
    type,
    occurred_at: "2026-09-29T03:00:00.000Z",
    payload,
    branch_id: "br-1",
    actor_id: "m-1",
    entity_type: "order",
    entity_id: "ent-1",
    actor: "คุณปิยะ",
    ...over,
  });
  const noName = () => undefined;

  it("says what someone did to an order in words, marking the ones an owner should look at", () => {
    expect(describeActivity(ev("order.discounted", { type: "percent", value: 50, reason: "ลูกค้าประจำ" }), noName)).toEqual({ text: "คุณปิยะ ให้ส่วนลด 50% (ลูกค้าประจำ)", tone: "warn" });
    expect(describeActivity(ev("order.discounted", { type: "amount", value: 20, reason: null }), noName)).toEqual({ text: "คุณปิยะ ให้ส่วนลด ฿20", tone: "warn" });
    expect(describeActivity(ev("order.voided", { reason: "ลูกค้ายกเลิก" }), noName)).toEqual({ text: "คุณปิยะ ยกเลิกบิล (ลูกค้ายกเลิก)", tone: "bad" });
    expect(describeActivity(ev("order.refunded", { amount: 45, reason: "เมนูผิด" }), noName)).toEqual({ text: "คุณปิยะ คืนเงิน ฿45 (เมนูผิด)", tone: "bad" });
    // A line taken off before it went to the kitchen is less serious than one already sent.
    expect(describeActivity(ev("order.item_voided", { name: "ลาเต้", reason: "สั่งผิด", was_sent: false }), noName)!.tone).toBe("warn");
    expect(describeActivity(ev("order.item_voided", { name: "ลาเต้", reason: "สั่งผิด", was_sent: true }), noName)!.tone).toBe("bad");
  });

  it("describes shifts, stock, day closing and orders to suppliers", () => {
    expect(describeActivity(ev("shift.closed", { variance: -20 }), noName)).toEqual({ text: "คุณปิยะ ปิดกะ เงินสดขาด ฿20", tone: "warn" });
    expect(describeActivity(ev("shift.closed", { variance: 0 }), noName)!.text).toBe("คุณปิยะ ปิดกะ เงินสดตรงพอดี");
    expect(describeActivity(ev("inventory.waste_recorded", { qty: 500, reason: "expired" }, { entity_id: "ing-1" }), (id) => (id === "ing-1" ? "หมูสับ" : undefined))!.text).toBe("คุณปิยะ บันทึกของเสีย “หมูสับ” (หมดอายุ)");
    expect(describeActivity(ev("finance.day_closed", { business_date: "2026-09-28", total: 1234.5, orders: 12 }), noName)).toEqual({ text: "คุณปิยะ ปิดยอดวันที่ 2026-09-28 ยอดขาย ฿1,234.5 (12 บิล)", tone: "good" });
    expect(describeActivity(ev("purchasing.po_approved", { po_no: "PO2609-0001" }), noName)!.text).toBe("คุณปิยะ อนุมัติใบสั่งซื้อ PO2609-0001");
    expect(describeActivity(ev("purchasing.po_sent", { po_no: "PO2609-0001" }), noName)!.text).toBe("คุณปิยะ ส่งให้ผู้ขายใบสั่งซื้อ PO2609-0001");
  });

  it("attributes what the system did to 'ระบบ', and names an ingredient's price rise so other screens can act on it", () => {
    const d = describeActivity(ev("inventory.price_increased", { name: "นมสด", old_cost: 0.045, new_cost: 0.05, change_pct: 11.1 }, { actor: null, entity_id: "ing-milk", entity_type: "ingredient" }), noName)!;
    expect(d).toEqual({ text: "ราคา “นมสด” ขึ้น 11.1% จากครั้งก่อน", tone: "warn", data: { ingredientId: "ing-milk", pct: 11.1 } });
    expect(describeActivity(ev("shift.opened", { opening_float: 1000 }, { actor: null }), noName)!.text).toBe("ระบบ เปิดกะ เงินทอนตั้งต้น ฿1,000");
  });

  it("leaves out routine events, and keeps the rest in order with who and where", () => {
    const rows = [ev("order.opened", { order_no: "001" }), ev("kitchen.ticket_fired", {}), ev("order.voided", { reason: "x" }, { id: "keep", actor_id: null, branch_id: null }), ev("kitchen.item_toggled", {})];
    const feed = mapActivity(rows, noName);
    expect(feed.map((e) => e.id)).toEqual(["keep"]);
    expect(feed[0]).toMatchObject({ type: "order.voided", actorId: undefined, branchId: undefined, at: "2026-09-29T03:00:00.000Z" });
  });
});
