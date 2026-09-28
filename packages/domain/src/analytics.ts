/**
 * The owner's four questions, as pure functions:
 *   อะไรขายดี · ขายที่ไหน · ผ่านช่องทางไหน · สุดท้ายเหลือเงินจริงเท่าไร
 */
import { daysBetween } from "./business-date";
import type { Satang } from "./money";

// ---------------------------------------------------------------------------
// "เหลือเงินจริงเท่าไร" — profit waterfall
// ---------------------------------------------------------------------------
export interface ProfitInput {
  /** Sales excluding VAT (after discounts). */
  netSales: Satang;
  cogs: Satang;
  waste: Satang;
  stockVariance: Satang;
  commission: Satang;
  paymentFees: Satang;
  expenses: Satang;
}

export interface WaterfallStep {
  key: "net_sales" | "cogs" | "waste" | "stock_variance" | "commission" | "payment_fees" | "expenses" | "profit";
  label: string;
  labelEn: string;
  value: Satang;
  /** Running total after this step (for drawing the waterfall). */
  running: Satang;
  kind: "start" | "minus" | "end";
  /** Share of net sales, 0–1. */
  pctOfSales: number;
  explain: string;
}

export function profitWaterfall(i: ProfitInput): WaterfallStep[] {
  const pct = (v: number) => (i.netSales > 0 ? v / i.netSales : 0);
  const steps: Omit<WaterfallStep, "running" | "pctOfSales">[] = [
    { key: "net_sales", label: "ยอดขายสุทธิ", labelEn: "Net sales", value: i.netSales, kind: "start", explain: "ยอดขายหลังหักส่วนลด ไม่รวม VAT" },
    { key: "cogs", label: "ต้นทุนวัตถุดิบ", labelEn: "Food cost", value: -i.cogs, kind: "minus", explain: "คำนวณจากสูตรของเมนูที่ขายไป" },
    { key: "commission", label: "ค่า GP เดลิเวอรี", labelEn: "Delivery commission", value: -i.commission, kind: "minus", explain: "ค่าคอมมิชชันแพลตฟอร์มตามอัตรา ณ วันที่ขาย" },
    { key: "payment_fees", label: "ค่าธรรมเนียมรับเงิน", labelEn: "Payment fees", value: -i.paymentFees, kind: "minus", explain: "ค่าธรรมเนียมบัตรและ e-Wallet" },
    { key: "waste", label: "ของเสีย", labelEn: "Waste", value: -i.waste, kind: "minus", explain: "ของที่บันทึกว่าเสีย/หมดอายุ/ทำหก" },
    { key: "stock_variance", label: "ของหายจากการนับ", labelEn: "Stock variance", value: -i.stockVariance, kind: "minus", explain: "ส่วนต่างระหว่างสต็อกในระบบกับที่นับได้จริง" },
    { key: "expenses", label: "ค่าใช้จ่ายร้าน", labelEn: "Operating expenses", value: -i.expenses, kind: "minus", explain: "ค่าเช่า ค่าแรง ค่าน้ำไฟ ที่บันทึกไว้" },
  ];
  let running = 0;
  const out: WaterfallStep[] = steps.map((s) => {
    running += s.value;
    return { ...s, running, pctOfSales: pct(Math.abs(s.value)) };
  });
  out.push({
    key: "profit",
    label: "เหลือเงินจริง",
    labelEn: "What you keep",
    value: running,
    running,
    kind: "end",
    pctOfSales: pct(running),
    explain: "กำไรจากการดำเนินงานหลังหักทุกอย่างที่ระบบรู้",
  });
  return out;
}

/**
 * Accrual view of an expense: the part of `amount` that belongs to [from, to],
 * spread evenly over its service period (e.g. September rent over 30 days).
 * Mirrors the expense branch of app.v_branch_daily_pnl.
 */
export function allocateToRange(
  amount: Satang,
  period: { start: string; end: string },
  range: { from: string; to: string },
): Satang {
  const days = daysBetween(period.start, period.end) + 1;
  if (days <= 0) return 0;
  const start = period.start > range.from ? period.start : range.from;
  const end = period.end < range.to ? period.end : range.to;
  const overlap = daysBetween(start, end) + 1;
  if (overlap <= 0) return 0;
  return overlap === days ? amount : Math.round((amount * overlap) / days);
}

// ---------------------------------------------------------------------------
// "ผ่านช่องทางไหน" — channel profitability
// ---------------------------------------------------------------------------
export interface ChannelSales {
  channelId: string;
  name: string;
  orders: number;
  netSales: Satang;
  cost: Satang;
  commission: Satang;
  paymentFees: Satang;
}

export interface ChannelProfit extends ChannelSales {
  contribution: Satang;
  marginPct: number;
  avgTicket: Satang;
  shareOfSales: number;
  shareOfContribution: number;
}

/** Contribution margin per channel — delivery often sells a lot but keeps little. */
export function channelProfitability(rows: ChannelSales[]): ChannelProfit[] {
  const totalSales = rows.reduce((s, r) => s + r.netSales, 0);
  const withContribution = rows.map((r) => ({ ...r, contribution: r.netSales - r.cost - r.commission - r.paymentFees }));
  const totalContribution = withContribution.reduce((s, r) => s + r.contribution, 0);
  return withContribution
    .map((r) => ({
      ...r,
      marginPct: r.netSales > 0 ? r.contribution / r.netSales : 0,
      avgTicket: r.orders > 0 ? Math.round(r.netSales / r.orders) : 0,
      shareOfSales: totalSales > 0 ? r.netSales / totalSales : 0,
      shareOfContribution: totalContribution > 0 ? r.contribution / totalContribution : 0,
    }))
    .sort((a, b) => b.contribution - a.contribution);
}

// ---------------------------------------------------------------------------
// "อะไรขายดี" — menu engineering (Kasavana & Smith)
// ---------------------------------------------------------------------------
export interface ItemPerformance {
  menuItemId: string;
  name: string;
  qty: number;
  sales: Satang;
  cost: Satang;
}

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

export const MENU_CLASS_COPY: Record<MenuClass, { th: string; en: string; advice: string; emoji: string }> = {
  star: { th: "ดาวเด่น", en: "Star", advice: "ขายดีและกำไรดี — รักษาคุณภาพ วางตำแหน่งเด่นในเมนู", emoji: "⭐" },
  plowhorse: { th: "ขายดีแต่กำไรน้อย", en: "Plowhorse", advice: "ลองขึ้นราคาเล็กน้อย หรือปรับสูตร/ขนาดเพื่อลดต้นทุน", emoji: "🐎" },
  puzzle: { th: "กำไรดีแต่ขายน้อย", en: "Puzzle", advice: "โปรโมตเพิ่ม ให้พนักงานแนะนำ หรือเปลี่ยนชื่อ/รูปให้น่าสนใจ", emoji: "🧩" },
  dog: { th: "ควรพิจารณาใหม่", en: "Dog", advice: "ขายน้อยและกำไรน้อย — พิจารณาเอาออกหรือปรับใหม่ทั้งเมนู", emoji: "🔍" },
};

export interface EngineeredItem extends ItemPerformance {
  contributionPerItem: Satang;
  mixPct: number;
  class: MenuClass;
}

export function menuEngineering(items: ItemPerformance[]): EngineeredItem[] {
  const active = items.filter((i) => i.qty > 0);
  if (active.length === 0) return [];
  const totalQty = active.reduce((s, i) => s + i.qty, 0);
  // Popularity threshold: 70 % of an equal share (classic Kasavana-Smith rule).
  const popularityThreshold = (1 / active.length) * 0.7;
  const totalContribution = active.reduce((s, i) => s + (i.sales - i.cost), 0);
  const avgContribution = totalContribution / totalQty;
  return active
    .map((i) => {
      const contributionPerItem = Math.round((i.sales - i.cost) / i.qty);
      const mixPct = i.qty / totalQty;
      const popular = mixPct >= popularityThreshold;
      const profitable = contributionPerItem >= avgContribution;
      const cls: MenuClass = popular ? (profitable ? "star" : "plowhorse") : profitable ? "puzzle" : "dog";
      return { ...i, contributionPerItem, mixPct, class: cls };
    })
    .sort((a, b) => b.sales - a.sales);
}

// ---------------------------------------------------------------------------
// Period comparison helpers for KPI tiles
// ---------------------------------------------------------------------------
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

export type Trend = "up" | "down" | "flat";
export function trend(current: number, previous: number, flatBand = 0.02): Trend {
  const pc = percentChange(current, previous);
  if (pc === null) return current > 0 ? "up" : "flat";
  if (Math.abs(pc) < flatBand) return "flat";
  return pc > 0 ? "up" : "down";
}
