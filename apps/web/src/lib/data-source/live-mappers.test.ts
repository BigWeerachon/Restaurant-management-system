import { describe, expect, it } from "vitest";
import { orderApi, ticketApi } from "./fixtures";
import { mapBalances, mapClosedShift, mapCount, mapCurrentShift, mapMovement, mapOrder, mapPurchaseOrder, mapTicket } from "./live-mappers";

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
