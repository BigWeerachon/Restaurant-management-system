/**
 * Pay per order (plan `per_order`): 0.50 baht for each paid order, never more than 990 baht a month for one branch.
 * A month under 100 baht is not billed; it is carried into the next month's bill. Money is satang (integers).
 *
 * The database decides in `app.usage_billing_run()` / `app.usage_meter()`; this is the same rule for the screens and
 * the demo. Both run the same vectors (test/usage.test.ts and packages/db/tests/005_usage_billing.sql).
 */
export const USAGE_PER_ORDER_SATANG = 50;
export const USAGE_BRANCH_CAP_SATANG = 99_000;
export const USAGE_MIN_INVOICE_SATANG = 10_000;

/** Orders a branch can have before the cap is reached (1,980). */
export const USAGE_ORDERS_TO_CAP = USAGE_BRANCH_CAP_SATANG / USAGE_PER_ORDER_SATANG;

/** The fee for one branch's paid orders in a month. Voided and refunded orders are not passed in. */
export function branchUsageFee(paidOrders: number): number {
  return Math.min(Math.max(0, Math.floor(paidOrders)) * USAGE_PER_ORDER_SATANG, USAGE_BRANCH_CAP_SATANG);
}

export type UsageOutcome = "nothing" | "carried" | "invoiced";

export interface UsageStatement {
  orders: number;
  fee: number;
  carriedIn: number;
  total: number;
  outcome: UsageOutcome;
}

/**
 * A month's statement. `carriedIn` is last month's carried amount; `unpaid` is a usage bill still open, which the new
 * bill replaces (so it is always billed, even when the total is small).
 */
export function usageStatement(branchOrders: readonly number[], carriedIn = 0, unpaid = 0): UsageStatement {
  const orders = branchOrders.reduce((a, n) => a + Math.max(0, Math.floor(n)), 0);
  const fee = branchOrders.reduce((a, n) => a + branchUsageFee(n), 0);
  const total = fee + carriedIn + unpaid;
  const outcome: UsageOutcome = total === 0 ? "nothing" : total < USAGE_MIN_INVOICE_SATANG && unpaid === 0 ? "carried" : "invoiced";
  return { orders, fee, carriedIn: carriedIn + unpaid, total, outcome };
}
