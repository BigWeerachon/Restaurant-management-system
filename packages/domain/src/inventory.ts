/**
 * Inventory rules shared by the database trigger (app.apply_stock_movement)
 * and the offline-capable apps.
 */
export type StockReason =
  | "opening"
  | "purchase"
  | "sale"
  | "sale_void"
  | "waste"
  | "count_adjust"
  | "transfer_out"
  | "transfer_in"
  | "production_out"
  | "production_in"
  | "return_to_supplier"
  | "manual_adjust";

export interface Balance {
  qty: number;
  avgCost: number;
}

export interface MovementInput {
  qty: number;
  unitCost?: number;
  reason: StockReason;
}

const AT_AVERAGE: ReadonlySet<StockReason> = new Set(["count_adjust", "manual_adjust", "sale_void"]);

/**
 * Moving weighted-average cost. Outflows (and corrections) move at the current
 * average; inflows blend in at their own cost. Negative stock is allowed — the
 * kitchen is never blocked from selling — and the next inflow resets the average.
 */
export function applyMovement(
  balance: Balance,
  m: MovementInput,
  fallbackCost = 0,
): { balance: Balance; unitCost: number } {
  const current = balance.avgCost > 0 ? balance.avgCost : fallbackCost;
  let unitCost: number;
  let avg: number;
  if (m.qty < 0 || AT_AVERAGE.has(m.reason)) {
    unitCost = current;
    avg = balance.avgCost;
  } else {
    unitCost = m.unitCost && m.unitCost > 0 ? m.unitCost : current;
    avg =
      balance.qty <= 0
        ? unitCost
        : (balance.qty * balance.avgCost + m.qty * unitCost) / (balance.qty + m.qty);
  }
  return {
    balance: { qty: round4(balance.qty + m.qty), avgCost: round6(avg) },
    unitCost,
  };
}

export type StockStatus = "negative" | "out" | "low" | "ok";

export function stockStatus(qty: number, reorderPoint?: number | null): StockStatus {
  if (qty < 0) return "negative";
  if (qty === 0) return "out";
  if (reorderPoint != null && qty <= reorderPoint) return "low";
  return "ok";
}

export interface ReorderInput {
  onHand: number;
  onOrder?: number;
  reorderPoint?: number | null;
  parLevel?: number | null;
  /** Base units per purchase pack. */
  packQty?: number | null;
}

/** "ควรสั่งเท่าไร" — top up to par (or 2× reorder point), in whole packs. */
export function reorderSuggestion(i: ReorderInput): { qty: number; packs: number } | null {
  if (i.reorderPoint == null) return null;
  const available = i.onHand + (i.onOrder ?? 0);
  if (available > i.reorderPoint) return null;
  const target = i.parLevel ?? i.reorderPoint * 2;
  const qty = Math.max(target - available, 0);
  if (qty === 0) return null;
  const pack = i.packQty && i.packQty > 0 ? i.packQty : 1;
  const packs = Math.ceil(qty / pack);
  return { qty: packs * pack, packs };
}

export interface CountLine {
  ingredientId: string;
  name: string;
  expected: number;
  counted: number | null;
  unitCost: number;
}

export interface CountSummary {
  counted: number;
  uncounted: number;
  varianceValue: number;
  /** Largest losses first — where a manager should look. */
  biggestLosses: Array<CountLine & { variance: number; value: number }>;
}

export function summarizeCount(lines: CountLine[], top = 5): CountSummary {
  const withVariance = lines
    .filter((l) => l.counted != null)
    .map((l) => {
      const variance = round4((l.counted as number) - l.expected);
      return { ...l, variance, value: round2(variance * l.unitCost) };
    });
  return {
    counted: withVariance.length,
    uncounted: lines.length - withVariance.length,
    varianceValue: round2(withVariance.reduce((s, l) => s + l.value, 0)),
    biggestLosses: withVariance
      .filter((l) => l.value < 0)
      .sort((a, b) => a.value - b.value)
      .slice(0, top),
  };
}

export interface UsageInput {
  ingredientId: string;
  /** From recipes × sales (what should have been used). */
  theoretical: number;
  opening: number;
  purchases: number;
  closing: number;
  unitCost: number;
}

/**
 * Actual vs theoretical usage: actual = opening + purchases − closing.
 * A positive gap means more left the shelf than recipes explain
 * (over-portioning, unrecorded waste, theft).
 */
export function usageVariance(u: UsageInput) {
  const actual = round4(u.opening + u.purchases - u.closing);
  const gap = round4(actual - u.theoretical);
  return {
    ingredientId: u.ingredientId,
    actual,
    theoretical: u.theoretical,
    gap,
    gapPct: u.theoretical > 0 ? gap / u.theoretical : 0,
    gapValue: round2(gap * u.unitCost),
  };
}

/** Days until a stock item runs out at the recent usage pace. */
export function daysOfCover(onHand: number, avgDailyUsage: number): number | null {
  if (avgDailyUsage <= 0) return null;
  return Math.max(onHand, 0) / avgDailyUsage;
}

export const WASTE_REASONS = [
  { code: "expired", th: "หมดอายุ", en: "Expired", icon: "calendar-x" },
  { code: "spoiled", th: "เสีย/บูด", en: "Spoiled", icon: "thermometer" },
  { code: "dropped", th: "ทำหก/ตกหล่น", en: "Dropped", icon: "droplet" },
  { code: "overcooked", th: "ทำเสีย/ไหม้", en: "Overcooked", icon: "flame" },
  { code: "wrong_order", th: "ทำผิดออเดอร์", en: "Wrong order", icon: "shuffle" },
  { code: "staff_meal", th: "อาหารพนักงาน", en: "Staff meal", icon: "users" },
  { code: "tasting", th: "ชิม/ทดลองสูตร", en: "Tasting", icon: "chef-hat" },
  { code: "other", th: "อื่นๆ", en: "Other", icon: "more-horizontal" },
] as const;
export type WasteReason = (typeof WASTE_REASONS)[number]["code"];

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function round4(n: number) {
  return Math.round(n * 10_000) / 10_000;
}
function round6(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000;
}
