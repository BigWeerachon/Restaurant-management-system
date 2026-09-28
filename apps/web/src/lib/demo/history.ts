/**
 * Deterministic 30-day sales history for the sample shop, as daily aggregates
 * (the same shape as the app.v_item_sales / v_branch_daily_pnl read models).
 * Seeded PRNG → identical numbers on every device, so screenshots and the
 * scorecard are reproducible.
 */
import { addDays, applyRate, divRound, menuItemCost, type Recipe, type Satang } from "@sabai/domain";
import { modifierPrice, priceFor, recipeBook } from "./engine";
import type { DemoState, Expense, MenuItem } from "./types";

export interface HistoryDay {
  date: string;
  branchId: string;
  channelId: string;
  orders: number;
  gross: Satang;
  netSales: Satang;
  vat: Satang;
  cost: Satang;
  commission: Satang;
  fees: Satang;
  items: Record<string, { qty: number; sales: Satang; cost: Satang }>;
  hours: number[];
}

export interface HistoryBranchDay {
  date: string;
  branchId: string;
  waste: Satang;
  variance: Satang;
}

export interface History {
  days: HistoryDay[];
  branchDays: HistoryBranchDay[];
  expenses: Expense[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const DOW = [1.22, 0.86, 0.9, 0.95, 1.0, 1.16, 1.32]; // Sun..Sat
const BASE_ORDERS: Record<string, number> = { "br-ari": 95, "br-tl": 122 };
const CHANNEL_MIX: Record<string, Record<string, number>> = {
  "br-ari": { "ch-dine": 0.42, "ch-take": 0.26, "ch-grab": 0.19, "ch-lineman": 0.13 },
  "br-tl": { "ch-dine": 0.52, "ch-take": 0.2, "ch-grab": 0.17, "ch-lineman": 0.11 },
};
// Morning coffee rush, lunch peak, afternoon slump, early evening.
const HOUR_WEIGHTS = [0, 0, 0, 0, 0, 0, 0, 3, 8, 9, 7, 9, 12, 10, 6, 5, 6, 6, 5, 4, 3, 2, 1, 0];

function pickWeighted<T>(items: T[], weight: (t: T) => number, rnd: () => number): T {
  const total = items.reduce((s, i) => s + weight(i), 0);
  let x = rnd() * total;
  for (const i of items) {
    x -= weight(i);
    if (x <= 0) return i;
  }
  return items[items.length - 1]!;
}

export function generateHistory(state: DemoState, today: string, days = 30): History {
  if (state.mode !== "demo") return { days: [], branchDays: [], expenses: [] };
  const book = recipeBook(state);
  const itemCost = new Map<string, number>();
  const extraShot = modifierPrice(state, "mo-shot")?.recipe;
  for (const mi of state.menuItems) itemCost.set(mi.id, menuItemCost(mi.recipe, [], book));
  const shotCost = extraShot ? menuItemCost(undefined, [extraShot as Recipe], book) : 0;

  const out: HistoryDay[] = [];
  const branchDays: HistoryBranchDay[] = [];
  const items = state.menuItems.filter((m) => m.active);
  const drinks = items.filter((m) => m.route === "bar");
  const food = items.filter((m) => m.route === "kitchen");

  for (let d = days; d >= 1; d--) {
    const date = addDays(today, -d);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const growth = 1 + (days - d) * 0.0028;
    for (const branch of state.branches) {
      const rnd = mulberry32(hashString(`${date}:${branch.id}`));
      const base = (BASE_ORDERS[branch.id] ?? 80) * DOW[dow]! * growth * (0.9 + rnd() * 0.2);
      let branchCost = 0;
      for (const [channelId, share] of Object.entries(CHANNEL_MIX[branch.id] ?? {})) {
        const channel = state.channels.find((c) => c.id === channelId);
        if (!channel) continue;
        const orders = Math.max(1, Math.round(base * share));
        const row: HistoryDay = { date, branchId: branch.id, channelId, orders, gross: 0, netSales: 0, vat: 0, cost: 0, commission: 0, fees: 0, items: {}, hours: new Array(24).fill(0) };
        const delivery = channel.kind === "delivery_platform";
        for (let o = 0; o < orders; o++) {
          const hour = pickWeighted(HOUR_WEIGHTS.map((w, h) => ({ w, h })), (x) => x.w, rnd).h;
          row.hours[hour]! += 1;
          const lines = 1 + (rnd() < 0.55 ? 1 : 0) + (rnd() < 0.15 ? 1 : 0);
          let orderGross = 0;
          for (let l = 0; l < lines; l++) {
            const pool: MenuItem[] = delivery ? (rnd() < 0.55 ? food : drinks) : l === 0 && hour < 11 ? drinks : rnd() < 0.62 ? drinks : food;
            const mi = pickWeighted(pool, (m) => m.weight, rnd);
            const qty = rnd() < 0.1 ? 2 : 1;
            const shot = mi.modifierGroupIds.includes("mg-extra") && rnd() < 0.12;
            const price = (priceFor(mi, channel) + (shot ? 1500 : 0)) * qty;
            const cost = Math.round(((itemCost.get(mi.id) ?? 0) + (shot ? shotCost : 0)) * qty * 100);
            const slot = (row.items[mi.id] ??= { qty: 0, sales: 0, cost: 0 });
            slot.qty += qty;
            slot.sales += price - divRound(price * 700, 10700);
            slot.cost += cost;
            row.cost += cost;
            orderGross += price;
          }
          row.gross += orderGross;
          if (!delivery && rnd() < 0.28) row.fees += applyRate(orderGross, 0.02);
        }
        row.vat = divRound(row.gross * 700, 10700);
        row.netSales = row.gross - row.vat;
        row.commission = applyRate(row.gross, channel.commissionRate);
        branchCost += row.cost;
        out.push(row);
      }
      branchDays.push({
        date,
        branchId: branch.id,
        waste: Math.round(branchCost * (0.009 + rnd() * 0.008)),
        variance: Math.round(branchCost * (0.002 + rnd() * 0.009)),
      });
    }
  }

  return { days: out, branchDays, expenses: historyExpenses(today, days) };
}

/** Recurring costs the owner recorded (rent, wages, utilities, marketing, supplies). */
function historyExpenses(today: string, days: number): Expense[] {
  const out: Expense[] = [];
  const monthOf = (date: string) => {
    const start = `${date.slice(0, 8)}01`;
    return { periodStart: start, periodEnd: addDays(addDays(start, 32).slice(0, 8) + "01", -1) };
  };
  const add = (branchId: string, date: string, category: Expense["category"], description: string, baht: number, period: { periodStart: string; periodEnd: string }, paidFrom: Expense["paidFrom"] = "bank") =>
    out.push({ id: `hx-${branchId}-${date}-${category}-${out.length}`, branchId, date, category, description, amount: baht * 100, paidFrom, ...period });
  // Start a month early: last month's bills still cover the first days of the window.
  for (let d = days + 31; d >= 0; d--) {
    const date = addDays(today, -d);
    const day = Number(date.slice(8));
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (day === 1) {
      add("br-ari", date, "rent", "ค่าเช่าร้าน สาขาอารีย์", 45000, monthOf(date));
      add("br-tl", date, "rent", "ค่าเช่าร้าน สาขาทองหล่อ", 65000, monthOf(date));
    }
    if (day === 5) {
      add("br-ari", date, "utilities", "ค่าไฟ ค่าน้ำ ค่าแก๊ส", 12400, monthOf(date));
      add("br-tl", date, "utilities", "ค่าไฟ ค่าน้ำ ค่าแก๊ส", 17800, monthOf(date));
    }
    if (day === 28) {
      add("br-ari", date, "salaries", "เงินเดือนพนักงาน 5 คน", 72000, monthOf(date));
      add("br-tl", date, "salaries", "เงินเดือนพนักงาน 7 คน", 108000, monthOf(date));
    }
    if (dow === 1) {
      const week = { periodStart: date, periodEnd: addDays(date, 6) };
      add("br-ari", date, "marketing", "โฆษณาบนแพลตฟอร์มเดลิเวอรี", 1800, week);
      add("br-tl", date, "marketing", "โฆษณาบนแพลตฟอร์มเดลิเวอรี", 2400, week);
      add("br-ari", date, "supplies", "ของใช้สิ้นเปลือง น้ำยาล้างจาน ทิชชู", 1350, week, "cash_on_hand");
      add("br-tl", date, "supplies", "ของใช้สิ้นเปลือง น้ำยาล้างจาน ทิชชู", 1750, week, "cash_on_hand");
    }
  }
  return out;
}
