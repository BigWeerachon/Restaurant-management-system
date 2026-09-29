import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSabai } from "../demo/store";
import { clearApiSession, setApiSession } from "./http-client";
import { httpDataSource as ds } from "./http-data-source";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeApi(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { key: string; url: string; body: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: any) => {
      const u = new URL(String(url));
      const key = `${init?.method ?? "GET"} ${u.pathname}`;
      calls.push({ key, url: u.pathname + u.search, body: init?.body ? JSON.parse(init.body) : undefined });
      const r = routes[key];
      return r ? json(r.status ?? 200, r.body) : json(404, { error: { code: "NOT_FOUND" } });
    }),
  );
  return calls;
}

const denied = { status: 403, body: { error: { code: "PERMISSION_DENIED" } } };
const bill = { id: "b-1", internal_no: "BILL-1", bill_no: null, bill_date: "2026-09-20", due_date: "2026-10-05", total: "500.00", amount_paid: "0.00", status: "open", supplier_id: "su-1", source_id: null };

describe("HttpDataSource finance", () => {
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

  it("loads bills, this branch's expenses and closed days, and the bank lines with what is still expected", async () => {
    const other = useSabai.getState().db.branches.find((b) => b.id !== branchId)!.id;
    useSabai.getState().patch((d) => {
      d.expenses = [{ id: "keep", branchId: other, date: "2026-09-01", category: "rent", description: "อีกสาขา", amount: 100, paidFrom: "bank" }];
      d.expected = [{ id: "keep-x", branchId: other, label: "อีกสาขา", expectedDate: "2026-09-30", amount: 100, sourceType: "card_batch", status: "open" }];
    });
    const calls = fakeApi({
      "GET /v1/bills": { body: [bill] },
      "GET /v1/expenses": { body: [{ id: "e-1", branch_id: branchId, expense_date: "2026-09-29", period_start: null, period_end: null, description: "ค่าไฟ", amount: "1500.00", paid_from: "bank", account_key: "utilities" }] },
      "GET /v1/days": { body: [{ business_date: "2026-09-28", status: "closed", closed_at: "2026-09-29T02:00:00.000Z", summary: { orders: 3, total: "300.00", vat: "19.63" } }, { business_date: "2026-09-27", status: "reopened", closed_at: null, summary: null }] },
      "GET /v1/reconciliation": {
        body: {
          unmatchedLines: [{ id: "l-1", txn_date: "2026-09-30", amount: "480.00", description: "KBank" }],
          matchedLines: [{ id: "l-0", txn_date: "2026-09-29", amount: "100.00", description: "GrabFood" }],
          expected: [
            { id: "x-1", branch_id: branchId, status: "open", label: "บัตร", expected_date: "2026-09-30", expected_amount: "480.00", source_type: "card_batch", payer: "acc" },
            { id: "x-2", branch_id: other, status: "open", label: "ของอีกสาขา", expected_date: "2026-09-30", expected_amount: "1.00", source_type: "card_batch", payer: "acc" },
          ],
        },
      },
    });
    await ds.load(["finance"]);
    const { db } = useSabai.getState();
    expect(db.bills.map((b) => [b.id, b.total])).toEqual([["b-1", 50000]]);
    expect(db.expenses.map((e) => [e.id, e.category])).toEqual([["keep", "rent"], ["e-1", "utilities"]]);
    // A reopened day is not a closed day.
    expect(db.dayCloses.filter((c) => c.branchId === branchId).map((c) => c.businessDate)).toEqual(["2026-09-28"]);
    expect(db.statementLines.map((l) => [l.id, l.status])).toEqual([["l-1", "unmatched"], ["l-0", "matched"]]);
    expect(db.expected.map((e) => e.id)).toEqual(["keep-x", "x-1"]);
    expect(calls.find((c) => c.key === "GET /v1/expenses")!.url).toContain(`branchId=${branchId}`);
  });

  it("leaves alone whatever this person may not read, and still loads the rest", async () => {
    useSabai.getState().patch((d) => {
      d.statementLines = [{ id: "old", date: "2026-09-01", amount: 1, description: "เก่า", status: "unmatched" }];
    });
    fakeApi({ "GET /v1/bills": { body: [bill] }, "GET /v1/expenses": denied, "GET /v1/days": denied, "GET /v1/reconciliation": denied });
    await ds.load(["finance"]);
    const { db } = useSabai.getState();
    expect(db.bills).toHaveLength(1);
    expect(db.statementLines.map((l) => l.id)).toEqual(["old"]);
  });

  it("fails as a whole when something other than permission goes wrong", async () => {
    fakeApi({ "GET /v1/bills": { status: 500, body: { error: { code: "INTERNAL" } } }, "GET /v1/expenses": { body: [] }, "GET /v1/days": { body: [] }, "GET /v1/reconciliation": { body: { unmatchedLines: [], matchedLines: [], expected: [] } } });
    await expect(ds.load(["finance"])).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("closes the day, then gives the summary from the server's totals and the drawer's difference from the day's shifts", async () => {
    const shiftRow = (id: string, date: string, variance: string) => ({ id, business_date: date, status: "closed", opening_float: "1000.00", expected_cash: "2000.00", counted_cash: "2000.00", cash_variance: variance, opened_at: "2026-09-29T02:00:00.000Z", closed_at: "2026-09-29T12:00:00.000Z", opened_by: "m-owner" });
    const calls = fakeApi({
      "POST /v1/days/2026-09-29/close": { body: { businessDate: "2026-09-29", orders: 4, total: "321.00", vat: "21.00", grossSales: "321.00" } },
      "GET /v1/orders": { body: [] },
      "GET /v1/shifts/current": { body: { shift: null } },
      "GET /v1/shifts": { body: [shiftRow("s-1", "2026-09-29", "-10.00"), shiftRow("s-2", "2026-09-29", "2.50"), shiftRow("s-3", "2026-09-28", "9.99")] },
      "GET /v1/bills": { body: [] },
      "GET /v1/expenses": { body: [] },
      "GET /v1/days": { body: [] },
      "GET /v1/reconciliation": { body: { unmatchedLines: [], matchedLines: [], expected: [] } },
    });
    const summary = await ds.closeDay("2026-09-29");
    expect(calls[0]).toMatchObject({ key: "POST /v1/days/2026-09-29/close", body: { branchId } });
    // Only the shifts of that day count towards the difference: −฿10.00 and +฿2.50.
    expect(summary).toEqual({ orders: 4, total: 32100, vat: 2100, netSales: 30000, byChannel: [], byMethod: [], cashVariance: -750 });
    expect(calls.map((c) => c.key)).toEqual(expect.arrayContaining(["GET /v1/orders", "GET /v1/shifts", "GET /v1/reconciliation"]));
  });

  it("does not turn a database refusal into a summary", async () => {
    fakeApi({ "POST /v1/days/2026-09-29/close": { status: 409, body: { error: { code: "OPEN_ORDERS_EXIST", details: { count: 2 } } } } });
    await expect(ds.closeDay("2026-09-29")).rejects.toMatchObject({ code: "OPEN_ORDERS_EXIST" });
  });

  it("records an expense in baht with its own branch, category and period, then reloads", async () => {
    const calls = fakeApi({
      "POST /v1/expenses": { body: { id: "e-9" } },
      "GET /v1/bills": { body: [] },
      "GET /v1/expenses": { body: [] },
      "GET /v1/days": { body: [] },
      "GET /v1/reconciliation": { body: { unmatchedLines: [], matchedLines: [], expected: [] } },
    });
    await ds.addExpense({ branchId, date: "2026-09-29", category: "rent", description: " ค่าเช่า ", amount: 3000050, paidFrom: "bank", periodStart: "2026-09-01", periodEnd: "2026-09-30" });
    expect(calls[0]!.body).toEqual({ branchId, expenseDate: "2026-09-29", category: "rent", description: "ค่าเช่า", amount: "30000.50", paidFrom: "bank", periodStart: "2026-09-01", periodEnd: "2026-09-30" });
    expect(calls.map((c) => c.key)).toContain("GET /v1/expenses");
  });

  it("pays a bill from the bank in baht, and matches or skips a bank line", async () => {
    const calls = fakeApi({
      "POST /v1/bills/b-1/pay": { body: { ok: true } },
      "POST /v1/statement-lines/l-1/match": { body: { variance: "0.00" } },
      "POST /v1/statement-lines/l-2/ignore": { body: { ok: true } },
      "GET /v1/bills": { body: [] },
      "GET /v1/expenses": { body: [] },
      "GET /v1/days": { body: [] },
      "GET /v1/reconciliation": { body: { unmatchedLines: [], matchedLines: [], expected: [] } },
    });
    await ds.payBill("b-1", 12345);
    await ds.matchStatementLine("l-1", ["x-1", "x-2"], "หักค่าธรรมเนียม");
    await ds.ignoreStatementLine("l-2");
    const posts = calls.filter((c) => c.key.startsWith("POST"));
    expect(posts.map((c) => [c.key, c.body])).toEqual([
      ["POST /v1/bills/b-1/pay", { amount: "123.45", from: "bank" }],
      ["POST /v1/statement-lines/l-1/match", { expectedIds: ["x-1", "x-2"], note: "หักค่าธรรมเนียม" }],
      ["POST /v1/statement-lines/l-2/ignore", { note: "ไม่เกี่ยวกับการขาย" }],
    ]);
  });
});
