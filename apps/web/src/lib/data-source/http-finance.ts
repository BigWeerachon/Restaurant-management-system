/** Finance commands for the API adapter: close the day, record expenses, pay bills, match bank lines. */
import { toSatang } from "@sabai/domain";
import { useSabai } from "../demo/store";
import { apiFetch } from "./http-client";
import { baht, currentBranchId, refresh } from "./http-context";
import type { DataSource } from "./types";

/** Shown in the bank-line list when someone says a transfer has nothing to do with sales. */
const NOT_A_SALE = "ไม่เกี่ยวกับการขาย";

export const financeCommands = {
  async closeDay(date) {
    const branchId = currentBranchId();
    const r = await apiFetch<{ orders: number; total: string; vat: string }>(`/v1/days/${date}/close`, { method: "POST", body: { branchId } });
    // Closing writes the day's books, expected bank money and locks the day: all of it is worth reading back.
    await refresh(["orders", "shifts", "finance"]);
    const total = toSatang(r.total);
    const vat = toSatang(r.vat);
    // What the drawer was off by, from the shifts that ended that day (counted at closing, so the server has them).
    const cashVariance = useSabai
      .getState()
      .db.shifts.filter((s) => s.branchId === branchId && s.businessDate === date)
      .reduce((sum, s) => sum + (s.variance ?? 0), 0);
    return { orders: r.orders, total, netSales: total - vat, vat, byChannel: [], byMethod: [], cashVariance };
  },

  async addExpense(expense) {
    await apiFetch("/v1/expenses", {
      method: "POST",
      body: {
        branchId: expense.branchId ?? currentBranchId(),
        expenseDate: expense.date,
        category: expense.category,
        description: expense.description.trim(),
        amount: baht(expense.amount),
        paidFrom: expense.paidFrom,
        periodStart: expense.periodStart,
        periodEnd: expense.periodEnd,
      },
    });
    // Expenses feed the reports; bills only change when it was put on credit.
    await refresh(["finance"]);
  },

  async payBill(billId, amount) {
    await apiFetch(`/v1/bills/${billId}/pay`, { method: "POST", body: { amount: baht(amount), from: "bank" } });
    await refresh(["finance"]);
  },

  async matchStatementLine(lineId, expectedIds, note) {
    await apiFetch(`/v1/statement-lines/${lineId}/match`, { method: "POST", body: { expectedIds, note } });
    await refresh(["finance"]);
  },

  async ignoreStatementLine(lineId) {
    await apiFetch(`/v1/statement-lines/${lineId}/ignore`, { method: "POST", body: { note: NOT_A_SALE } });
    await refresh(["finance"]);
  },
} satisfies Partial<DataSource>;
