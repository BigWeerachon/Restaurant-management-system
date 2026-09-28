import {
  addDays,
  allocateToRange,
  channelProfitability,
  menuEngineering,
  onboardingProgress,
  profitWaterfall,
  reorderSuggestion,
  stockStatus,
  type OnboardingFacts,
  type Satang,
  type StockStatus,
} from "@sabai/domain";
import { balanceKey, currentBusinessDate, unitCostOf } from "./engine";
import type { History } from "./history";
import type { DemoState, Ingredient } from "./types";

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------
export interface StockRow {
  ingredient: Ingredient;
  qty: number;
  unitCost: number;
  value: number;
  status: StockStatus;
  onOrder: number;
  suggestion: { qty: number; packs: number } | null;
  daysLeft: number | null;
}

export function stockRows(state: DemoState, branchId: string, now = new Date()): StockRow[] {
  const since = addDays(currentBusinessDate(state, branchId, now), -7);
  const usage = new Map<string, number>();
  for (const m of state.movements) {
    if (m.branchId === branchId && m.reason === "sale" && m.businessDate >= since) usage.set(m.ingredientId, (usage.get(m.ingredientId) ?? 0) - m.qty);
  }
  const onOrder = new Map<string, number>();
  for (const po of state.purchaseOrders) {
    if (po.branchId !== branchId || !["approved", "sent", "partially_received"].includes(po.status)) continue;
    for (const l of po.lines) onOrder.set(l.ingredientId, (onOrder.get(l.ingredientId) ?? 0) + (l.qtyPacks - l.receivedPacks) * l.packQty);
  }
  const order: Record<StockStatus, number> = { negative: 0, out: 1, low: 2, ok: 3 };
  return state.ingredients
    .filter((i) => i.trackStock)
    .map((ingredient) => {
      const qty = state.balances[balanceKey(branchId, ingredient.id)]?.qty ?? 0;
      const unitCost = unitCostOf(state, ingredient, branchId);
      const daily = (usage.get(ingredient.id) ?? 0) / 7;
      return {
        ingredient,
        qty,
        unitCost,
        value: Math.max(qty, 0) * unitCost,
        status: stockStatus(qty, ingredient.reorderPoint),
        onOrder: onOrder.get(ingredient.id) ?? 0,
        suggestion: reorderSuggestion({ onHand: qty, onOrder: onOrder.get(ingredient.id) ?? 0, reorderPoint: ingredient.reorderPoint, parLevel: ingredient.parLevel, packQty: ingredient.pack?.qty }),
        daysLeft: daily > 0 ? Math.max(qty, 0) / daily : null,
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.ingredient.name.localeCompare(b.ingredient.name, "th"));
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------
export function onboardingFacts(state: DemoState): OnboardingFacts {
  const main = state.branches[0];
  return {
    branchReady: !!(main?.address || main?.phone),
    paymentsReady: state.paymentMethods.some((m) => m.active && (m.kind === "promptpay" || m.kind === "card")) || state.tenant.onboarding.paymentsConfirmed,
    ingredients: state.ingredients.length,
    menuItems: state.menuItems.length,
    recipes: state.menuItems.filter((m) => m.recipe?.lines.length).length,
    staff: state.members.filter((m) => m.active).length,
    hasSale: state.orders.some((o) => o.status === "paid") || state.mode === "demo",
    skipped: state.tenant.onboarding.skipped,
  };
}

export function onboarding(state: DemoState) {
  return onboardingProgress(onboardingFacts(state));
}

// ---------------------------------------------------------------------------
// Reports — history aggregates + live orders, same maths as the API
// ---------------------------------------------------------------------------
export interface ReportFilter {
  from: string;
  to: string;
  branchId?: string | null;
}

export function reportSummary(state: DemoState, history: History, f: ReportFilter) {
  const inRange = (d: string) => d >= f.from && d <= f.to;
  const inBranch = (b?: string) => !f.branchId || b === f.branchId;

  const daily = new Map<string, { netSales: number; contribution: number; orders: number }>();
  const channels = new Map<string, { orders: number; netSales: number; cost: number; commission: number; paymentFees: number }>();
  const items = new Map<string, { qty: number; sales: number; cost: number }>();
  const branches = new Map<string, { netSales: number; orders: number; contribution: number }>();
  const hours = new Array(24).fill(0) as number[];
  let waste = 0;
  let variance = 0;

  const bump = (date: string, branchId: string, channelId: string, orders: number, netSales: number, cost: number, commission: number, fees: number) => {
    const d = daily.get(date) ?? { netSales: 0, contribution: 0, orders: 0 };
    d.netSales += netSales;
    d.orders += orders;
    d.contribution += netSales - cost - commission - fees;
    daily.set(date, d);
    const c = channels.get(channelId) ?? { orders: 0, netSales: 0, cost: 0, commission: 0, paymentFees: 0 };
    c.orders += orders;
    c.netSales += netSales;
    c.cost += cost;
    c.commission += commission;
    c.paymentFees += fees;
    channels.set(channelId, c);
    const b = branches.get(branchId) ?? { netSales: 0, orders: 0, contribution: 0 };
    b.netSales += netSales;
    b.orders += orders;
    b.contribution += netSales - cost - commission - fees;
    branches.set(branchId, b);
  };

  for (const h of history.days) {
    if (!inRange(h.date) || !inBranch(h.branchId)) continue;
    bump(h.date, h.branchId, h.channelId, h.orders, h.netSales, h.cost, h.commission, h.fees);
    h.hours.forEach((n, i) => (hours[i]! += n));
    for (const [id, v] of Object.entries(h.items)) {
      const it = items.get(id) ?? { qty: 0, sales: 0, cost: 0 };
      it.qty += v.qty;
      it.sales += v.sales;
      it.cost += v.cost;
      items.set(id, it);
    }
  }
  for (const b of history.branchDays) {
    if (!inRange(b.date) || !inBranch(b.branchId)) continue;
    waste += b.waste;
    variance += b.variance;
  }

  for (const o of state.orders) {
    if (o.status !== "paid" || !inRange(o.businessDate) || !inBranch(o.branchId)) continue;
    const cost = Math.round((o.cost ?? 0) * 100);
    const fees = o.payments.reduce((s, p) => s + p.fee, 0);
    bump(o.businessDate, o.branchId, o.channelId, 1, o.totals.netSales, cost, o.totals.commission, fees);
    hours[new Date(o.openedAt).getHours()]! += 1;
    const share = o.totals.itemsTotal > 0 ? o.totals.netSales / o.totals.itemsTotal : 0;
    for (const i of o.items) {
      if (i.status === "voided") continue;
      const it = items.get(i.menuItemId) ?? { qty: 0, sales: 0, cost: 0 };
      const line = i.qty * (i.unitPrice + i.modifiers.reduce((s, m) => s + m.priceDelta, 0));
      it.qty += i.qty;
      it.sales += Math.round(line * share);
      it.cost += Math.round((i.cost ?? 0) * 100);
      items.set(i.menuItemId, it);
    }
  }
  for (const m of state.movements) {
    if (!inRange(m.businessDate) || !inBranch(m.branchId)) continue;
    if (m.reason === "waste") waste += Math.round(-m.qty * m.unitCost * 100);
    if (m.reason === "count_adjust") variance += Math.round(-m.qty * m.unitCost * 100);
  }

  // Accrual view: each expense counts for the days its service period overlaps.
  const expenses = [...history.expenses, ...state.expenses]
    .filter((e) => !f.branchId || e.branchId === f.branchId)
    .reduce((s, e) => s + allocateToRange(e.amount, { start: e.periodStart ?? e.date, end: e.periodEnd ?? e.date }, { from: f.from, to: f.to }), 0);

  const totals = [...channels.values()].reduce(
    (a, c) => ({ netSales: a.netSales + c.netSales, cost: a.cost + c.cost, commission: a.commission + c.commission, fees: a.fees + c.paymentFees, orders: a.orders + c.orders }),
    { netSales: 0, cost: 0, commission: 0, fees: 0, orders: 0 },
  );

  const waterfall = profitWaterfall({
    netSales: totals.netSales,
    cogs: totals.cost,
    waste,
    stockVariance: variance,
    commission: totals.commission,
    paymentFees: totals.fees,
    expenses,
  });

  const channelRows = channelProfitability(
    [...channels].map(([channelId, c]) => ({
      channelId,
      name: state.channels.find((x) => x.id === channelId)?.name ?? channelId,
      ...c,
    })),
  );

  const engineered = menuEngineering(
    [...items].map(([menuItemId, v]) => ({ menuItemId, name: state.menuItems.find((m) => m.id === menuItemId)?.name ?? "—", ...v })),
  );

  const days: { date: string; netSales: number; contribution: number; orders: number }[] = [];
  for (let d = f.from; d <= f.to; d = addDays(d, 1)) days.push({ date: d, ...(daily.get(d) ?? { netSales: 0, contribution: 0, orders: 0 }) });

  return {
    totals: { ...totals, waste, variance, expenses, avgTicket: totals.orders ? Math.round(totals.netSales / totals.orders) : 0 },
    waterfall,
    channels: channelRows,
    items: engineered,
    days,
    hours,
    branches: [...branches].map(([id, b]) => ({ id, name: state.branches.find((x) => x.id === id)?.name ?? id, ...b })).sort((a, b) => b.netSales - a.netSales),
  };
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------
export function todayStats(state: DemoState, history: History, branchId: string | null, now: Date) {
  const branchIds = branchId ? [branchId] : state.branches.map((b) => b.id);
  const today = currentBusinessDate(state, branchIds[0]!, now);
  const paid = state.orders.filter((o) => o.status === "paid" && o.businessDate === today && branchIds.includes(o.branchId));
  const sales = paid.reduce((s, o) => s + o.totals.total, 0);
  const net = paid.reduce((s, o) => s + o.totals.netSales, 0);
  const cost = paid.reduce((s, o) => s + Math.round((o.cost ?? 0) * 100), 0);
  const commission = paid.reduce((s, o) => s + o.totals.commission, 0);
  const fees = paid.reduce((s, o) => s + o.payments.reduce((x, p) => x + p.fee, 0), 0);

  // Same weekday last week, up to the same hour — a fair comparison mid-day.
  const lastWeek = addDays(today, -7);
  const hour = now.getHours();
  let lastWeekSales = 0;
  let lastWeekOrders = 0;
  for (const h of history.days) {
    if (h.date !== lastWeek || !branchIds.includes(h.branchId)) continue;
    const upto = h.hours.slice(0, hour + 1).reduce((a, b) => a + b, 0);
    const share = h.orders ? upto / h.orders : 0;
    lastWeekSales += Math.round(h.gross * share);
    lastWeekOrders += upto;
  }

  const spark = history.days.length
    ? Array.from({ length: 14 }, (_, i) => {
        const d = addDays(today, i - 14);
        return history.days.filter((h) => h.date === d && branchIds.includes(h.branchId)).reduce((s, h) => s + h.gross, 0);
      })
    : [];

  return {
    today,
    sales,
    orders: paid.length,
    avgTicket: paid.length ? Math.round(sales / paid.length) : 0,
    keep: net - cost - commission - fees,
    keepPct: net > 0 ? (net - cost - commission - fees) / net : 0,
    lastWeekSales,
    lastWeekOrders,
    spark: [...spark, sales],
    open: state.orders.filter((o) => o.status === "open" && branchIds.includes(o.branchId)).length,
  };
}

export interface Alert {
  id: string;
  tone: "warn" | "bad" | "info";
  title: string;
  detail: string;
  href: string;
  cta: string;
}

export function alerts(state: DemoState, branchId: string, today: string, now = new Date()): Alert[] {
  const out: Alert[] = [];
  const rows = stockRows(state, branchId, now);
  const out0 = rows.filter((r) => r.status === "out" || r.status === "negative");
  const low = rows.filter((r) => r.status === "low");
  if (out0.length) out.push({ id: "stock-out", tone: "bad", title: `ของหมด ${out0.length} รายการ`, detail: out0.slice(0, 3).map((r) => r.ingredient.name).join(", "), href: "/purchasing", cta: "สั่งซื้อ" });
  if (low.length) out.push({ id: "stock-low", tone: "warn", title: `ของใกล้หมด ${low.length} รายการ`, detail: low.slice(0, 3).map((r) => r.ingredient.name).join(", "), href: "/purchasing", cta: "ดูจำนวนที่ควรสั่ง" });
  const overdue = state.bills.filter((b) => b.status !== "paid" && b.dueDate < today);
  const dueSoon = state.bills.filter((b) => b.status !== "paid" && b.dueDate >= today && b.dueDate <= addDays(today, 3));
  if (overdue.length) out.push({ id: "bills-overdue", tone: "bad", title: `บิลเลยกำหนดจ่าย ${overdue.length} ใบ`, detail: `รวม ฿${(overdue.reduce((s, b) => s + b.total - b.paid, 0) / 100).toLocaleString("th-TH")}`, href: "/finance?tab=bills", cta: "จ่ายบิล" });
  if (dueSoon.length) out.push({ id: "bills-soon", tone: "info", title: `บิลครบกำหนดใน 3 วัน ${dueSoon.length} ใบ`, detail: dueSoon.map((b) => state.suppliers.find((s) => s.id === b.supplierId)?.name).join(", "), href: "/finance?tab=bills", cta: "ดูบิล" });
  const recentAlerts = state.receipts.filter((r) => r.branchId === branchId && r.at >= addDays(today, -2)).flatMap((r) => r.priceAlerts);
  for (const a of recentAlerts.slice(0, 2)) {
    const ing = state.ingredients.find((i) => i.id === a.ingredientId);
    out.push({ id: `price-${a.ingredientId}`, tone: "warn", title: `ราคา${ing?.name}ขึ้น ${a.pct}%`, detail: "ต้นทุนเมนูที่ใช้วัตถุดิบนี้เปลี่ยนแล้ว ลองดูว่าควรปรับราคาไหม", href: "/menu?sort=cost", cta: "ดูผลกระทบ" });
  }
  const unmatched = state.statementLines.filter((l) => l.status === "unmatched").length;
  if (unmatched) out.push({ id: "recon", tone: "info", title: `รายการเงินเข้ารอตรวจ ${unmatched} รายการ`, detail: "ระบบจับคู่ให้แล้ว แค่กดยืนยัน", href: "/finance?tab=reconcile", cta: "ตรวจเลย" });
  const stale = state.orders.filter((o) => o.status === "open" && o.branchId === branchId && now.getTime() - Date.parse(o.openedAt) > 90 * 60_000);
  if (stale.length) out.push({ id: "stale-orders", tone: "warn", title: `บิลเปิดค้างนานเกิน 90 นาที ${stale.length} บิล`, detail: "ลูกค้าอาจลืมชำระเงิน", href: "/orders?status=open", cta: "ดูบิล" });
  return out;
}

export function formatBaht(satang: Satang, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const v = satang / 100;
  const abs = Math.abs(v);
  // Compact: whole baht from ฿1,000 up (a KPI never needs satang), "K" from ฿1M.
  const text =
    opts.compact && abs >= 1_000_000
      ? `${(abs / 1000).toLocaleString("th-TH", { maximumFractionDigits: 0 })}K`
      : opts.compact && abs >= 1000
        ? abs.toLocaleString("th-TH", { maximumFractionDigits: 0 })
        : abs.toLocaleString("th-TH", { minimumFractionDigits: abs % 1 === 0 && opts.compact ? 0 : 2, maximumFractionDigits: 2 });
  const sign = v < 0 ? "-" : opts.sign && v > 0 ? "+" : "";
  return `${sign}฿${text}`;
}
