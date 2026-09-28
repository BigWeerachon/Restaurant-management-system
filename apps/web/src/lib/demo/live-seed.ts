/**
 * Makes the sample shop feel alive: a shift already open, bills sold earlier
 * today, drinks and dishes cooking on the KDS right now, a delivery that just
 * came in, supplier bills, and bank lines waiting to be reconciled.
 * Everything goes through the real engine commands.
 */
import { addDays, applyRate, type Satang } from "@sabai/domain";
import {
  newId,
  openShift,
  payOrder,
  receiveGoods,
  recordWaste,
  setTicketStatus,
  submitOrder,
  type Ctx,
} from "./engine";
import type { History } from "./history";
import type { DemoState } from "./types";

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedLive(state: DemoState, now: Date, today: string, history: History) {
  if (state.mode !== "demo") return;
  const rnd = mulberry(Number(today.replace(/-/g, "")));
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);
  const sys = (branchId: string, minutesAgo: number, actorId = "m-cashier"): Ctx => ({ now: at(minutesAgo), actorId, branchId, system: true });

  // Yesterday's delivery with a price increase → an alert for the owner.
  receiveGoods(state, { now: at(20 * 60), actorId: "m-stock", branchId: "br-ari", system: true }, {
    supplierId: "sup-dairy",
    paymentMode: "credit",
    lines: [{ ingredientId: "ing-milk", packName: "ขวด 2 ลิตร", packQty: 2000, qtyPacks: 6, unitPrice: 10400 }],
  });

  const drinks = state.menuItems.filter((m) => m.route === "bar");
  const food = state.menuItems.filter((m) => m.route === "kitchen");
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const defaults = (menuItemId: string) => {
    const mi = state.menuItems.find((m) => m.id === menuItemId)!;
    return mi.modifierGroupIds.includes("mg-sweet") ? ["mo-sweet-normal"] : [];
  };

  // Today's bills follow the same hourly curve as the 30-day history, so
  // "vs same time last week" comparisons are fair at any hour of the day.
  const HOURS = [0, 0, 0, 0, 0, 0, 0, 3, 8, 9, 7, 9, 12, 10, 6, 5, 6, 6, 5, 4, 3, 2, 1, 0];
  const weightSum = HOURS.reduce((a, b) => a + b, 0);
  const localHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Bangkok" }).format(now));
  const minute = now.getMinutes();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const dowFactor = [1.22, 0.86, 0.9, 0.95, 1.0, 1.16, 1.32][dow]!;
  const perDay: Record<string, number> = { "br-ari": 95 * 1.08, "br-tl": 122 * 1.08 };
  const openAt = 7; // shift opens at 07:00

  for (const branch of state.branches) {
    const minutesSinceOpen = localHour >= openAt ? (localHour - openAt) * 60 + minute : 0;
    openShift(state, sys(branch.id, Math.max(minutesSinceOpen + 10, 30)), 200000);
    const daily = (perDay[branch.id] ?? 80) * dowFactor;
    for (let h = openAt; h <= Math.min(localHour, 23); h++) {
      const share = h === localHour ? minute / 60 : 1;
      const n = Math.round((daily * HOURS[h]!) / weightSum * share * (0.9 + rnd() * 0.2));
      for (let k = 0; k < n; k++) {
        const minuteOfHour = Math.floor(rnd() * (h === localHour ? Math.max(minute, 1) : 60));
        const minutesAgo = (localHour - h) * 60 + (minute - minuteOfHour);
        if (minutesAgo < 12) continue; // the freshest orders are the live ones below
        const r = rnd();
        const channelId = r < 0.45 ? "ch-dine" : r < 0.7 ? "ch-take" : r < 0.88 ? "ch-grab" : "ch-lineman";
        const lines = 1 + (rnd() < 0.55 ? 1 : 0) + (rnd() < 0.15 ? 1 : 0);
        const items = Array.from({ length: lines }, () => {
          const mi = rnd() < 0.62 ? pick(drinks) : pick(food);
          return { id: newId("oi"), menuItemId: mi.id, qty: rnd() < 0.1 ? 2 : 1, modifierOptionIds: defaults(mi.id) };
        });
        const orderId = newId("ord");
        const ctx = sys(branch.id, minutesAgo, rnd() < 0.5 ? "m-cashier" : "m-waiter");
        const table = channelId === "ch-dine" ? branch.tables[Math.floor(rnd() * branch.tables.length)]?.id : undefined;
        const order = submitOrder(state, ctx, { id: orderId, channelId, tableId: table, items, guestCount: channelId === "ch-dine" ? 1 + Math.floor(rnd() * 3) : undefined });
        for (const t of state.tickets.filter((x) => x.orderId === orderId)) {
          setTicketStatus(state, sys(branch.id, Math.max(minutesAgo - 3, 0)), t.id, "in_progress");
          setTicketStatus(state, sys(branch.id, Math.max(minutesAgo - 7, 0)), t.id, "ready");
        }
        const total = order.totals.total;
        const method = channelId === "ch-grab" || channelId === "ch-lineman" ? "pm-platform" : rnd() < 0.36 ? "pm-cash" : rnd() < 0.62 ? "pm-pp" : "pm-card";
        const tendered: Satang | undefined = method === "pm-cash" ? Math.ceil(total / 10000) * 10000 : undefined;
        payOrder(state, sys(branch.id, Math.max(minutesAgo - 8, 0)), orderId, [
          { methodId: method, amount: total, tendered, reference: method === "pm-card" ? String(1000 + Math.floor(rnd() * 8999)) : undefined },
        ]);
      }
    }
  }

  // Right now at Ari: three tickets cooking at different ages + a table still eating.
  const live = [
    { minutesAgo: 13, channelId: "ch-dine", table: "ari-A3", items: [["mi-kaprao-chicken", ["mo-egg", "mo-spicy-more"]], ["mi-latte", ["mo-sweet-less", "mo-oat"]]] },
    { minutesAgo: 6, channelId: "ch-grab", items: [["mi-friedrice-shrimp", []], ["mi-padsee-ew", ["mo-egg"]], ["mi-thaitea", ["mo-sweet-normal"]]] },
    { minutesAgo: 2, channelId: "ch-take", items: [["mi-americano", ["mo-sweet-none"]], ["mi-croissant", []]] },
    { minutesAgo: 1, channelId: "ch-dine", table: "ari-B2", items: [["mi-matcha", ["mo-sweet-normal"]], ["mi-honeytoast", []]] },
  ] as const;
  for (const l of live) {
    const id = newId("ord");
    submitOrder(state, sys("br-ari", l.minutesAgo, "m-waiter"), {
      id,
      channelId: l.channelId,
      tableId: "table" in l ? l.table : undefined,
      guestCount: l.channelId === "ch-dine" ? 2 : undefined,
      note: l.channelId === "ch-grab" ? "GF-2931 · ไรเดอร์กำลังมา" : undefined,
      items: l.items.map(([menuItemId, mods]) => ({ id: newId("oi"), menuItemId, qty: 1, modifierOptionIds: [...mods] })),
    });
    if (l.minutesAgo >= 6) {
      for (const t of state.tickets.filter((x) => x.orderId === id)) setTicketStatus(state, sys("br-ari", l.minutesAgo - 1), t.id, "in_progress");
    }
  }

  recordWaste(state, { now: at(95), actorId: "m-kitchen", branchId: "br-ari", system: true }, "ing-basil", 120, "spoiled", "ใบเหี่ยว");
  recordWaste(state, { now: at(40), actorId: "m-cashier", branchId: "br-ari", system: true }, "ing-milk", 350, "dropped");

  // Money side: supplier bills, and bank lines from the last week.
  state.bills.push(
    { id: newId("bill"), supplierId: "sup-roaster", billNo: "INV-DS-0921", date: addDays(today, -32), dueDate: addDays(today, -2), total: 1040000, paid: 0, status: "open" },
    { id: newId("bill"), supplierId: "sup-bakery", billNo: "BB-7781", date: addDays(today, -4), dueDate: addDays(today, 3), total: 356000, paid: 0, status: "open" },
  );

  // Expected receipts from history (last 8 days) + matching bank lines.
  const byDate = new Map<string, { card: number; grab: number; lineman: number }>();
  for (const d of history.days) {
    if (d.branchId !== "br-ari" || d.date < addDays(today, -8)) continue;
    const x = byDate.get(d.date) ?? { card: 0, grab: 0, lineman: 0 };
    if (d.channelId === "ch-grab") x.grab += d.gross - d.commission - applyRate(d.commission, 0.07);
    else if (d.channelId === "ch-lineman") x.lineman += d.gross - d.commission - applyRate(d.commission, 0.07);
    else x.card += d.fees * 49; // fees are 2 % of card sales → card net = 49 × fee
    byDate.set(d.date, x);
  }
  const dates = [...byDate.keys()].sort();
  for (const date of dates) {
    const x = byDate.get(date)!;
    const label = `${date.slice(8)}/${date.slice(5, 7)}`;
    state.expected.push(
      { id: `exp-card-${date}`, branchId: "br-ari", label: `บัตร ${label}`, expectedDate: addDays(date, 2), amount: x.card, sourceType: "card_batch", status: "open" },
      { id: `exp-grab-${date}`, branchId: "br-ari", label: `GrabFood ${label}`, expectedDate: addDays(date, 7), amount: x.grab, sourceType: "platform_payout", status: "open" },
      { id: `exp-lm-${date}`, branchId: "br-ari", label: `LINE MAN ${label}`, expectedDate: addDays(date, 7), amount: x.lineman, sourceType: "platform_payout", status: "open" },
    );
  }
  const exp = (id: string) => state.expected.find((e) => e.id === id)?.amount ?? 0;
  const [d1, d2, d3, d4] = dates.slice(0, 4);
  if (d1 && d2 && d3 && d4) {
    state.statementLines.push(
      { id: "sl-1", date: addDays(d1, 2), amount: exp(`exp-card-${d1}`), description: "KBANK EDC SETTLEMENT", status: "unmatched" },
      { id: "sl-2", date: addDays(d2, 2), amount: exp(`exp-card-${d2}`), description: "KBANK EDC SETTLEMENT", status: "unmatched" },
      { id: "sl-3", date: addDays(d2, 7), amount: exp(`exp-grab-${d1}`) + exp(`exp-grab-${d2}`), description: "GRAB THAILAND PAYOUT", status: "unmatched" },
      { id: "sl-4", date: addDays(d1, 7), amount: exp(`exp-lm-${d1}`) - 18000, description: "LINE MAN WONGNAI", status: "unmatched" },
      { id: "sl-5", date: addDays(d3, 1), amount: 5000000, description: "โอนจาก คุณปิยะ (เงินทุนเพิ่ม)", status: "unmatched" },
    );
  }
}
