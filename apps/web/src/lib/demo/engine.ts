/**
 * Demo backend. Each exported command mutates an Immer draft of DemoState and
 * enforces the same rules as the database commands (permissions, approvals,
 * idempotency, period lock, server-side pricing, stock explosion). Errors are
 * DomainError(code) — the UI turns them into human messages via
 * humanizeError(), exactly as it would for an API error envelope.
 */
import {
  accessFromRole,
  applyMovement,
  businessDate,
  calculateOrderTotals,
  can,
  cashRound,
  explodeRecipe,
  type CostIngredient,
  type ErrorCode,
  type Permission,
  type Recipe,
  type RecipeBook,
  type Satang,
  type StockReason,
  addDays,
  applyRate,
  menuItemCost,
  roundQty,
  WASTE_REASONS,
} from "@sabai/domain";
import type {
  Channel,
  DemoState,
  Expense,
  Ingredient,
  MenuItem,
  Member,
  Order,
  OrderItem,
  PaymentMethod,
  Role,
  Ticket,
} from "./types";

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly params: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "DomainError";
  }
}

export interface Ctx {
  now: Date;
  actorId: string | null;
  branchId: string;
  /** Seeding/background jobs skip permission checks. */
  system?: boolean;
}

let idCounter = 0;
export function newId(prefix = "id"): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

// ---------------------------------------------------------------------------
// Lookups & helpers
// ---------------------------------------------------------------------------
export function roleOf(state: DemoState, memberId: string | null | undefined): Role | undefined {
  const m = state.members.find((x) => x.id === memberId);
  return m ? state.roles.find((r) => r.key === m.roleKey) : undefined;
}

export function memberCan(state: DemoState, memberId: string | null | undefined, permission: Permission, branchId?: string): boolean {
  const m = state.members.find((x) => x.id === memberId && x.active);
  const role = roleOf(state, memberId);
  if (!m || !role) return false;
  if (branchId && m.branchIds !== "all" && !m.branchIds.includes(branchId)) return false;
  return can(accessFromRole({ grantsAll: role.grantsAll, permissions: role.permissions as Permission[] }), permission);
}

function requirePerm(state: DemoState, ctx: Ctx, permission: Permission) {
  if (ctx.system) return;
  if (!memberCan(state, ctx.actorId, permission, ctx.branchId)) throw new DomainError("PERMISSION_DENIED", { permission });
}

/** Actor has the permission, or a manager approved by PIN. Returns who authorised it. */
function authorise(state: DemoState, ctx: Ctx, permission: Permission, approverId?: string): string | undefined {
  if (ctx.system || memberCan(state, ctx.actorId, permission, ctx.branchId)) return ctx.actorId ?? undefined;
  if (!approverId) throw new DomainError("APPROVAL_REQUIRED", { permission });
  if (!memberCan(state, approverId, permission, ctx.branchId)) throw new DomainError("APPROVER_NOT_ALLOWED", { permission });
  return approverId;
}

export function currentBusinessDate(state: DemoState, branchId: string, now: Date): string {
  const b = state.branches.find((x) => x.id === branchId);
  const d = businessDate(now, { timeZone: "Asia/Bangkok", cutoff: b?.dayCutoff ?? "05:00" });
  return state.dayCloses.some((c) => c.branchId === branchId && c.businessDate === d) ? addDays(d, 1) : d;
}

function nextSeq(state: DemoState, key: string): number {
  state.seq[key] = (state.seq[key] ?? 0) + 1;
  return state.seq[key]!;
}

function log(state: DemoState, ctx: Ctx, type: string, text: string, tone: "neutral" | "good" | "warn" | "bad" = "neutral") {
  state.activity.unshift({ id: newId("ev"), at: ctx.now.toISOString(), type, actorId: ctx.actorId ?? undefined, branchId: ctx.branchId, text, tone });
  if (state.activity.length > 300) state.activity.length = 300;
}

export function actorName(state: DemoState, id?: string | null): string {
  return state.members.find((m) => m.id === id)?.name ?? "ระบบ";
}

export function balanceKey(branchId: string, ingredientId: string) {
  return `${branchId}:${ingredientId}`;
}

export function unitCostOf(state: DemoState, ing: Ingredient, branchId?: string): number {
  const bal = branchId ? state.balances[balanceKey(branchId, ing.id)] : undefined;
  return bal && bal.avgCost > 0 ? bal.avgCost : (ing.lastCost ?? ing.standardCost);
}

export function recipeBook(state: DemoState, branchId?: string): RecipeBook {
  const ingredients = new Map<string, CostIngredient>(
    state.ingredients.map((i) => [i.id, { id: i.id, name: i.name, kind: i.kind, trackStock: i.trackStock, unitCost: unitCostOf(state, i, branchId) }]),
  );
  return { ingredients, prepRecipes: new Map(Object.entries(state.prepRecipes)) };
}

/** Channel price: delivery menus carry a markup rounded up to a friendly ฿5. */
export function priceFor(item: Pick<MenuItem, "price">, channel?: Pick<Channel, "priceMarkup">): Satang {
  if (!channel || channel.priceMarkup <= 0) return item.price;
  const raw = item.price * (1 + channel.priceMarkup);
  return Math.ceil(raw / 500) * 500;
}

export function modifierPrice(state: DemoState, optionId: string): { name: string; priceDelta: Satang; recipe?: Recipe } | undefined {
  for (const g of state.modifierGroups) {
    const o = g.options.find((x) => x.id === optionId);
    if (o) return o;
  }
  return undefined;
}

export function orderTotals(state: DemoState, order: Order) {
  const channel = state.channels.find((c) => c.id === order.channelId);
  const branch = state.branches.find((b) => b.id === order.branchId);
  return calculateOrderTotals({
    lines: order.items.map((i) => ({
      qty: i.qty,
      unitPrice: i.unitPrice,
      modifiersTotal: i.modifiers.reduce((s, m) => s + m.priceDelta, 0),
      voided: i.status === "voided",
    })),
    discount: order.discount ? { type: order.discount.type, value: order.discount.value } : null,
    serviceChargeRate: channel?.appliesServiceCharge ? (branch?.serviceChargeRate ?? 0) : 0,
    vatRate: state.tenant.vatRegistered ? state.tenant.vatRate : 0,
    pricesIncludeVat: state.tenant.pricesIncludeVat,
    commissionRate: order.commissionRate,
    rounding: order.totals?.rounding ?? 0,
  });
}

function applyStock(
  state: DemoState,
  ctx: Ctx,
  branchId: string,
  ingredientId: string,
  qty: number,
  reason: StockReason,
  opts: { unitCost?: number; reasonCode?: string; note?: string; sourceId?: string; businessDate?: string } = {},
) {
  const ing = state.ingredients.find((i) => i.id === ingredientId);
  if (!ing || !ing.trackStock || qty === 0) return 0;
  const key = balanceKey(branchId, ingredientId);
  const bal = state.balances[key] ?? { qty: 0, avgCost: 0 };
  const { balance, unitCost } = applyMovement({ qty: bal.qty, avgCost: bal.avgCost }, { qty, unitCost: opts.unitCost, reason }, ing.lastCost ?? ing.standardCost);
  state.balances[key] = balance;
  if (reason === "purchase") ing.lastCost = unitCost;
  state.movements.push({
    id: newId("mv"),
    branchId,
    ingredientId,
    qty: roundQty(qty),
    unitCost,
    reason,
    reasonCode: opts.reasonCode,
    note: opts.note,
    sourceId: opts.sourceId,
    at: ctx.now.toISOString(),
    by: ctx.actorId ?? undefined,
    businessDate: opts.businessDate ?? currentBusinessDate(state, branchId, ctx.now),
  });
  if (state.movements.length > 4000) state.movements.splice(0, state.movements.length - 4000);
  return qty * unitCost;
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------
export function openShift(state: DemoState, ctx: Ctx, openingFloat: Satang) {
  requirePerm(state, ctx, "pos.pay");
  if (state.shifts.some((s) => s.branchId === ctx.branchId && s.status === "open")) throw new DomainError("SHIFT_ALREADY_OPEN");
  if (openingFloat < 0) throw new DomainError("INVALID_AMOUNT");
  const id = newId("shift");
  state.shifts.push({
    id,
    branchId: ctx.branchId,
    openedBy: ctx.actorId ?? "system",
    openedAt: ctx.now.toISOString(),
    openingFloat,
    status: "open",
    cashMoves: [],
    businessDate: currentBusinessDate(state, ctx.branchId, ctx.now),
  });
  log(state, ctx, "shift.opened", `${actorName(state, ctx.actorId)} เปิดกะ เงินทอนตั้งต้น ฿${(openingFloat / 100).toLocaleString("th-TH")}`);
  return id;
}

export function openShiftOf(state: DemoState, branchId: string) {
  return state.shifts.find((s) => s.branchId === branchId && s.status === "open");
}

export function expectedCash(state: DemoState, shiftId: string): Satang {
  const s = state.shifts.find((x) => x.id === shiftId);
  if (!s) return 0;
  const cashIds = new Set(state.paymentMethods.filter((m) => m.kind === "cash").map((m) => m.id));
  let cash = s.openingFloat;
  for (const o of state.orders) {
    if (o.shiftId !== s.id) continue;
    for (const p of o.payments) if (cashIds.has(p.methodId)) cash += p.kind === "payment" ? p.amount : -p.amount;
  }
  for (const m of s.cashMoves) cash += m.kind === "pay_in" ? m.amount : -m.amount;
  return cash;
}

export function cashMove(state: DemoState, ctx: Ctx, kind: "pay_in" | "pay_out", amount: Satang, reason: string) {
  requirePerm(state, ctx, "pos.manage_shift");
  const s = openShiftOf(state, ctx.branchId);
  if (!s) throw new DomainError("SHIFT_NOT_OPEN");
  if (amount <= 0) throw new DomainError("INVALID_AMOUNT");
  if (!reason.trim()) throw new DomainError("REASON_REQUIRED");
  s.cashMoves.push({ id: newId("cm"), kind, amount, reason, at: ctx.now.toISOString() });
  log(state, ctx, "shift.cash_move", `${actorName(state, ctx.actorId)} ${kind === "pay_in" ? "นำเงินเข้า" : "นำเงินออก"} ฿${(amount / 100).toLocaleString("th-TH")} (${reason})`);
}

export function closeShift(state: DemoState, ctx: Ctx, counted: Satang) {
  requirePerm(state, ctx, "pos.pay");
  const s = openShiftOf(state, ctx.branchId);
  if (!s) throw new DomainError("SHIFT_NOT_OPEN");
  const expected = expectedCash(state, s.id);
  s.status = "closed";
  s.closedAt = ctx.now.toISOString();
  s.countedCash = counted;
  s.expectedCash = expected;
  s.variance = counted - expected;
  const v = s.variance;
  log(
    state,
    ctx,
    "shift.closed",
    `${actorName(state, ctx.actorId)} ปิดกะ ${v === 0 ? "เงินสดตรงพอดี" : v < 0 ? `เงินขาด ฿${(-v / 100).toFixed(2)}` : `เงินเกิน ฿${(v / 100).toFixed(2)}`}`,
    v === 0 ? "good" : "warn",
  );
  return { expected, counted, variance: v };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export interface SubmitItemInput {
  id: string;
  menuItemId: string;
  qty: number;
  note?: string;
  modifierOptionIds: string[];
}

export interface SubmitOrderInput {
  id: string;
  channelId: string;
  tableId?: string;
  guestCount?: number;
  note?: string;
  items: SubmitItemInput[];
}

export function submitOrder(state: DemoState, ctx: Ctx, input: SubmitOrderInput): Order {
  requirePerm(state, ctx, "pos.order");
  let order = state.orders.find((o) => o.id === input.id);
  if (order && order.status !== "open") throw new DomainError("ORDER_NOT_OPEN", { status: order.status });

  const channel = state.channels.find((c) => c.id === (order?.channelId ?? input.channelId) && c.active);
  if (!channel) throw new DomainError("CHANNEL_NOT_FOUND");

  if (!order) {
    const bd = currentBusinessDate(state, ctx.branchId, ctx.now);
    order = {
      id: input.id,
      branchId: ctx.branchId,
      channelId: channel.id,
      tableId: input.tableId,
      orderNo: String(nextSeq(state, `order:${ctx.branchId}:${bd}`)).padStart(3, "0"),
      status: "open",
      businessDate: bd,
      openedAt: ctx.now.toISOString(),
      openedBy: ctx.actorId ?? undefined,
      guestCount: input.guestCount,
      note: input.note,
      items: [],
      payments: [],
      totals: calculateOrderTotals({ lines: [], serviceChargeRate: 0, vatRate: 0, pricesIncludeVat: true }),
      commissionRate: channel.commissionRate,
      shiftId: openShiftOf(state, ctx.branchId)?.id,
    };
    state.orders.push(order);
  }

  const added: OrderItem[] = [];
  for (const it of input.items) {
    if (order.items.some((x) => x.id === it.id)) continue; // idempotent per item id
    const mi = state.menuItems.find((m) => m.id === it.menuItemId && m.active);
    if (!mi) throw new DomainError("MENU_ITEM_NOT_FOUND");
    if (mi.soldOut[ctx.branchId]) throw new DomainError("MENU_ITEM_SOLD_OUT", { name: mi.name });
    if (!(it.qty > 0) || it.qty > 999) throw new DomainError("INVALID_QTY");
    const opts = new Set(it.modifierOptionIds);
    for (const gid of mi.modifierGroupIds) {
      const g = state.modifierGroups.find((x) => x.id === gid);
      if (!g) continue;
      const picked = g.options.filter((o) => opts.has(o.id)).length;
      if (picked < g.min || picked > g.max) throw new DomainError("MODIFIER_SELECTION", { group: g.name, min: g.min, max: g.max });
    }
    const allowed = new Set(mi.modifierGroupIds.flatMap((gid) => state.modifierGroups.find((g) => g.id === gid)?.options.map((o) => o.id) ?? []));
    for (const o of opts) if (!allowed.has(o)) throw new DomainError("INVALID_MODIFIER", { name: mi.name });

    const item: OrderItem = {
      id: it.id,
      menuItemId: mi.id,
      name: mi.name,
      emoji: mi.emoji,
      qty: it.qty,
      unitPrice: priceFor(mi, channel),
      modifiers: [...opts].map((oid) => {
        const o = modifierPrice(state, oid)!;
        return { id: oid, name: o.name, priceDelta: o.priceDelta };
      }),
      note: it.note?.trim() || undefined,
      status: "pending",
    };
    order.items.push(item);
    added.push(item);
  }
  order.totals = orderTotals(state, order);
  if (added.length) fireOrder(state, ctx, order);
  return order;
}

function fireOrder(state: DemoState, ctx: Ctx, order: Order) {
  const channel = state.channels.find((c) => c.id === order.channelId)!;
  const branch = state.branches.find((b) => b.id === order.branchId);
  const pending = order.items.filter((i) => i.status === "pending");
  const byStation = new Map<string, OrderItem[]>();
  for (const item of pending) {
    const mi = state.menuItems.find((m) => m.id === item.menuItemId);
    const station =
      state.stations.find((s) => s.branchId === order.branchId && s.route === mi?.route) ??
      state.stations.find((s) => s.branchId === order.branchId && s.route === "kitchen");
    if (!station) {
      item.status = "served";
      continue;
    }
    byStation.set(station.id, [...(byStation.get(station.id) ?? []), item]);
  }
  for (const [stationId, items] of byStation) {
    const t: Ticket = {
      id: newId("kt"),
      branchId: order.branchId,
      orderId: order.id,
      stationId,
      ticketNo: order.orderNo,
      status: "new",
      firedAt: ctx.now.toISOString(),
      channelName: channel.short,
      channelKind: channel.kind,
      tableName: branch?.tables.find((t) => t.id === order.tableId)?.name,
      items: items.map((i) => ({
        orderItemId: i.id,
        name: i.name,
        qty: i.qty,
        modifiers: i.modifiers.map((m) => m.name).join(" · "),
        note: i.note,
        status: "pending",
      })),
    };
    state.tickets.push(t);
    for (const i of items) i.status = "sent";
  }
  if (state.tickets.length > 400) {
    state.tickets = state.tickets.filter((t, idx) => t.status === "new" || t.status === "in_progress" || idx > state.tickets.length - 300);
  }
}

export function applyDiscount(state: DemoState, ctx: Ctx, orderId: string, type: "percent" | "amount", value: number, reason: string, approverId?: string) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new DomainError("NOT_FOUND");
  if (order.status !== "open") throw new DomainError("ORDER_NOT_OPEN");
  if (value < 0 || (type === "percent" && value > 100)) throw new DomainError("INVALID_DISCOUNT");
  if (!reason.trim()) throw new DomainError("REASON_REQUIRED");
  const rate = type === "percent" ? value / 100 : order.totals.itemsTotal > 0 ? value / order.totals.itemsTotal : 0;
  const capOf = (id?: string | null) => state.members.find((m) => m.id === id)?.maxDiscountRate ?? 1;

  let who: string | undefined;
  if (ctx.system || (memberCan(state, ctx.actorId, "pos.discount", ctx.branchId) && rate <= capOf(ctx.actorId))) {
    who = ctx.actorId ?? undefined;
  } else {
    if (!approverId) throw new DomainError("APPROVAL_REQUIRED", { permission: "pos.discount" });
    if (!memberCan(state, approverId, "pos.discount", ctx.branchId)) throw new DomainError("APPROVER_NOT_ALLOWED");
    if (rate > capOf(approverId)) throw new DomainError("DISCOUNT_OVER_LIMIT", { max_rate: capOf(approverId) });
    who = approverId;
  }
  order.discount = { type, value, reason, approvedBy: who !== ctx.actorId ? who : undefined };
  order.totals = orderTotals(state, order);
  log(
    state,
    ctx,
    "order.discounted",
    `${actorName(state, ctx.actorId)} ให้ส่วนลดบิล #${order.orderNo} ${type === "percent" ? `${value}%` : `฿${(value / 100).toFixed(2)}`} (${reason})${who !== ctx.actorId ? ` · อนุมัติโดย ${actorName(state, who)}` : ""}`,
    "warn",
  );
}

export function voidItem(state: DemoState, ctx: Ctx, orderId: string, itemId: string, reason: string, approverId?: string) {
  const order = state.orders.find((o) => o.id === orderId);
  const item = order?.items.find((i) => i.id === itemId);
  if (!order || !item) throw new DomainError("NOT_FOUND");
  if (order.status !== "open") throw new DomainError("ORDER_NOT_OPEN");
  if (item.status === "voided") return;
  if (!reason.trim()) throw new DomainError("REASON_REQUIRED");
  const who = item.status === "pending" ? (requirePerm(state, ctx, "pos.order"), ctx.actorId ?? undefined) : authorise(state, ctx, "pos.void", approverId);
  item.status = "voided";
  item.voidReason = reason;
  for (const t of state.tickets) for (const ti of t.items) if (ti.orderItemId === itemId) ti.status = "voided";
  order.totals = orderTotals(state, order);
  log(
    state,
    ctx,
    "order.item_voided",
    `${actorName(state, ctx.actorId)} ยกเลิก “${item.name}” บิล #${order.orderNo} (${reason})${who !== ctx.actorId ? ` · อนุมัติโดย ${actorName(state, who)}` : ""}`,
    "bad",
  );
}

export function voidOrder(state: DemoState, ctx: Ctx, orderId: string, reason: string, approverId?: string) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new DomainError("NOT_FOUND");
  if (order.status === "voided") return;
  if (order.status !== "open") throw new DomainError("ORDER_NOT_OPEN");
  if (!reason.trim()) throw new DomainError("REASON_REQUIRED");
  const sent = order.items.some((i) => i.status !== "pending" && i.status !== "voided");
  const who = sent ? authorise(state, ctx, "pos.void", approverId) : (requirePerm(state, ctx, "pos.order"), ctx.actorId ?? undefined);
  for (const i of order.items) i.status = "voided";
  for (const t of state.tickets) {
    if (t.orderId !== order.id) continue;
    for (const ti of t.items) ti.status = "voided";
    if (t.status === "new" || t.status === "in_progress") t.status = "cancelled";
  }
  order.status = "voided";
  order.totals = orderTotals(state, order);
  log(state, ctx, "order.voided", `${actorName(state, ctx.actorId)} ยกเลิกบิล #${order.orderNo} (${reason})${who !== ctx.actorId ? ` · อนุมัติโดย ${actorName(state, who)}` : ""}`, "bad");
}

export interface PaymentInput {
  methodId: string;
  amount: Satang;
  tendered?: Satang;
  reference?: string;
}

export function payOrder(state: DemoState, ctx: Ctx, orderId: string, payments: PaymentInput[]): Order {
  requirePerm(state, ctx, "pos.pay");
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new DomainError("NOT_FOUND");
  if (order.status === "paid") return order; // idempotent retry
  if (order.status !== "open") throw new DomainError("ORDER_NOT_OPEN");
  if (!order.items.some((i) => i.status !== "voided")) throw new DomainError("ORDER_EMPTY");
  if (payments.length === 0) throw new DomainError("PAYMENT_REQUIRED");

  const methods: PaymentMethod[] = payments.map((p) => {
    const m = state.paymentMethods.find((x) => x.id === p.methodId && x.active);
    if (!m) throw new DomainError("PAYMENT_METHOD_NOT_FOUND");
    if (m.requiresReference && !p.reference?.trim()) throw new DomainError("PAYMENT_REFERENCE_REQUIRED", { method: m.name });
    return m;
  });
  const shift = openShiftOf(state, order.branchId);
  if (methods.some((m) => m.kind === "cash") && !shift) throw new DomainError("SHIFT_REQUIRED");

  if (methods.every((m) => m.kind === "cash") && state.tenant.cashRounding !== "none") {
    const base = order.totals.total - order.totals.rounding;
    const { rounding } = cashRound(base, state.tenant.cashRounding);
    order.totals = orderTotals(state, { ...order, totals: { ...order.totals, rounding } });
  }

  let paid = 0;
  for (const [i, p] of payments.entries()) {
    const m = methods[i]!;
    if (!(p.amount > 0)) throw new DomainError("INVALID_AMOUNT");
    if (p.tendered !== undefined && (m.kind !== "cash" || p.tendered < p.amount)) throw new DomainError("INVALID_TENDERED");
    paid += p.amount;
  }
  if (paid !== order.totals.total) throw new DomainError("PAYMENT_TOTAL_MISMATCH", { total: order.totals.total / 100, paid: paid / 100 });

  order.payments = payments.map((p, i) => ({
    id: newId("pay"),
    methodId: p.methodId,
    kind: "payment",
    amount: p.amount,
    tendered: p.tendered,
    change: p.tendered !== undefined ? p.tendered - p.amount : 0,
    fee: applyRate(p.amount, methods[i]!.feeRate),
    reference: p.reference,
    at: ctx.now.toISOString(),
  }));

  // Consume stock: exploded recipes of every item + chosen modifiers.
  const book = recipeBook(state, order.branchId);
  const usage = new Map<string, number>();
  let cost = 0;
  for (const item of order.items) {
    if (item.status === "voided") continue;
    const mi = state.menuItems.find((m) => m.id === item.menuItemId);
    const modRecipes = item.modifiers.map((m) => modifierPrice(state, m.id)?.recipe).filter((x): x is Recipe => !!x);
    item.cost = menuItemCost(mi?.recipe, modRecipes, book) * item.qty;
    cost += item.cost;
    for (const rec of [mi?.recipe, ...modRecipes]) {
      if (!rec) continue;
      for (const [ing, q] of explodeRecipe(rec, item.qty, book)) usage.set(ing, (usage.get(ing) ?? 0) + q);
    }
  }
  for (const [ing, q] of usage) applyStock(state, ctx, order.branchId, ing, -q, "sale", { sourceId: order.id, businessDate: order.businessDate });

  order.cost = Math.round(cost * 100) / 100;
  order.status = "paid";
  order.paidAt = ctx.now.toISOString();
  order.shiftId = order.shiftId ?? shift?.id;
  const bd = order.businessDate;
  const branch = state.branches.find((b) => b.id === order.branchId);
  order.receiptNo = `${branch?.code ?? "HQ"}-${bd.slice(2, 4)}${bd.slice(5, 7)}-${String(nextSeq(state, `receipt:${order.branchId}:${bd.slice(0, 7)}`)).padStart(5, "0")}`;
  return order;
}

export function refundOrder(state: DemoState, ctx: Ctx, orderId: string, reason: string, restock: boolean, approverId?: string) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new DomainError("NOT_FOUND");
  if (order.status === "refunded") return;
  if (order.status !== "paid") throw new DomainError("ORDER_NOT_PAID");
  if (!reason.trim()) throw new DomainError("REASON_REQUIRED");
  const who = authorise(state, ctx, "pos.refund", approverId);
  for (const p of order.payments.filter((x) => x.kind === "payment")) {
    order.payments.push({ id: newId("pay"), methodId: p.methodId, kind: "refund", amount: p.amount, change: 0, fee: -p.fee, at: ctx.now.toISOString() });
  }
  if (restock) {
    for (const m of state.movements.filter((x) => x.sourceId === order.id && x.reason === "sale")) {
      applyStock(state, ctx, order.branchId, m.ingredientId, -m.qty, "sale_void", { sourceId: order.id });
    }
  }
  order.status = "refunded";
  log(state, ctx, "order.refunded", `${actorName(state, ctx.actorId)} คืนเงินบิล ${order.receiptNo} ฿${(order.totals.total / 100).toFixed(2)} (${reason})${who !== ctx.actorId ? ` · อนุมัติโดย ${actorName(state, who)}` : ""}`, "bad");
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------
export function setTicketStatus(state: DemoState, ctx: Ctx, ticketId: string, status: Ticket["status"]) {
  requirePerm(state, ctx, "kds.bump");
  const t = state.tickets.find((x) => x.id === ticketId);
  if (!t) throw new DomainError("NOT_FOUND");
  if (t.status === "cancelled") throw new DomainError("TICKET_CANCELLED");
  const order = state.orders.find((o) => o.id === t.orderId);
  const was = t.status;
  t.status = status;
  if (status === "in_progress") t.startedAt = t.startedAt ?? ctx.now.toISOString();
  if (status === "ready") {
    t.readyAt = ctx.now.toISOString();
    for (const ti of t.items) if (ti.status === "pending") ti.status = "done";
  }
  if ((status === "new" || status === "in_progress") && was === "ready") {
    t.readyAt = undefined;
    for (const ti of t.items) if (ti.status === "done") ti.status = "pending";
  }
  if (order) {
    for (const ti of t.items) {
      const oi = order.items.find((i) => i.id === ti.orderItemId);
      if (oi && oi.status !== "voided") oi.status = status === "ready" ? "ready" : "sent";
    }
  }
}

export function toggleTicketItem(state: DemoState, ctx: Ctx, ticketId: string, orderItemId: string) {
  requirePerm(state, ctx, "kds.bump");
  const t = state.tickets.find((x) => x.id === ticketId);
  const ti = t?.items.find((i) => i.orderItemId === orderItemId);
  if (!t || !ti || ti.status === "voided") return;
  ti.status = ti.status === "done" ? "pending" : "done";
  if (t.status === "new") {
    t.status = "in_progress";
    t.startedAt = ctx.now.toISOString();
  }
}

export function setSoldOut(state: DemoState, ctx: Ctx, menuItemId: string, soldOut: boolean) {
  requirePerm(state, ctx, "menu.availability");
  const mi = state.menuItems.find((m) => m.id === menuItemId);
  if (!mi) throw new DomainError("NOT_FOUND");
  mi.soldOut[ctx.branchId] = soldOut;
  log(state, ctx, "menu.availability", `${actorName(state, ctx.actorId)} ${soldOut ? "ปิดขาย (ของหมด)" : "เปิดขาย"} “${mi.name}”`, soldOut ? "warn" : "good");
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
export interface NewIngredientInput {
  name: string;
  emoji?: string;
  baseUnit: "g" | "ml" | "pcs";
  displayUnit?: string;
  category: string;
  pack?: { name: string; qty: number; price: Satang; supplierId?: string };
  reorderPoint?: number;
  parLevel?: number;
  openingQty?: number;
  zone?: string;
}

export function addIngredient(state: DemoState, ctx: Ctx, input: NewIngredientInput): Ingredient {
  requirePerm(state, ctx, "inventory.manage");
  const name = input.name.trim();
  if (!name) throw new DomainError("VALIDATION", { field: "name" });
  if (state.ingredients.some((i) => i.name.trim().toLowerCase() === name.toLowerCase())) throw new DomainError("CONFLICT");
  const unitCost = input.pack && input.pack.qty > 0 ? input.pack.price / 100 / input.pack.qty : 0;
  const ing: Ingredient = {
    id: newId("ing"),
    name,
    emoji: input.emoji || "📦",
    baseUnit: input.baseUnit,
    displayUnit: input.displayUnit,
    kind: "raw",
    trackStock: true,
    category: input.category || "อื่นๆ",
    reorderPoint: input.reorderPoint,
    parLevel: input.parLevel,
    standardCost: Math.round(unitCost * 1_000_000) / 1_000_000,
    lastCost: unitCost || undefined,
    zone: input.zone,
    countSort: state.ingredients.length,
    pack: input.pack,
  };
  state.ingredients.push(ing);
  if (input.openingQty && input.openingQty > 0) {
    applyStock(state, ctx, ctx.branchId, ing.id, input.openingQty, "opening", { unitCost: unitCost || undefined });
  }
  log(state, ctx, "inventory.ingredient_added", `${actorName(state, ctx.actorId)} เพิ่มวัตถุดิบ “${name}”`, "good");
  return ing;
}

export interface NewMenuItemInput {
  name: string;
  emoji: string;
  categoryId?: string;
  categoryName?: string;
  price: Satang;
  route: string;
  recipe?: Recipe;
  modifierGroupIds?: string[];
}

export function addMenuItem(state: DemoState, ctx: Ctx, input: NewMenuItemInput): MenuItem {
  requirePerm(state, ctx, "menu.manage");
  const name = input.name.trim();
  if (!name) throw new DomainError("VALIDATION", { field: "name" });
  if (!(input.price > 0)) throw new DomainError("INVALID_AMOUNT");
  let categoryId = input.categoryId;
  if (!categoryId) {
    const cname = (input.categoryName ?? "").trim() || "เมนูทั่วไป";
    const existing = state.menuCategories.find((c) => c.name === cname);
    categoryId = existing?.id;
    if (!categoryId) {
      categoryId = newId("cat");
      state.menuCategories.push({ id: categoryId, name: cname, emoji: input.emoji, color: "#13784f", sort: state.menuCategories.length + 1 });
    }
  }
  if (input.recipe?.lines.some((l) => !(l.qty > 0))) throw new DomainError("RECIPE_QTY_MUST_BE_POSITIVE");
  const item: MenuItem = {
    id: newId("mi"),
    categoryId,
    name,
    emoji: input.emoji || "🍽️",
    price: input.price,
    route: input.route,
    modifierGroupIds: input.modifierGroupIds ?? [],
    recipe: input.recipe && input.recipe.lines.length ? input.recipe : undefined,
    active: true,
    soldOut: {},
    weight: 5,
    tags: ["ใหม่"],
  };
  state.menuItems.push(item);
  log(state, ctx, "menu.item_added", `${actorName(state, ctx.actorId)} เพิ่มเมนู “${name}” ราคา ฿${(input.price / 100).toLocaleString("th-TH")}`, "good");
  return item;
}

export function updateMenuItem(state: DemoState, ctx: Ctx, id: string, patch: Partial<Pick<MenuItem, "price" | "name" | "recipe" | "active" | "emoji">>) {
  requirePerm(state, ctx, patch.recipe ? "recipes.manage" : "menu.manage");
  const mi = state.menuItems.find((m) => m.id === id);
  if (!mi) throw new DomainError("NOT_FOUND");
  if (patch.price !== undefined && patch.price !== mi.price) {
    log(state, ctx, "menu.price_changed", `${actorName(state, ctx.actorId)} เปลี่ยนราคา “${mi.name}” ฿${mi.price / 100} → ฿${patch.price / 100}`, "warn");
  }
  Object.assign(mi, patch);
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
export interface ReceiveInput {
  supplierId?: string;
  poId?: string;
  paymentMode: "credit" | "cash_paid" | "transfer_paid";
  lines: { ingredientId: string; packName: string; packQty: number; qtyPacks: number; unitPrice: Satang }[];
}

export function receiveGoods(state: DemoState, ctx: Ctx, input: ReceiveInput) {
  requirePerm(state, ctx, "inventory.receive");
  const lines = input.lines.filter((l) => l.qtyPacks > 0);
  if (lines.length === 0) throw new DomainError("LINES_REQUIRED");
  if (input.paymentMode === "credit" && !input.supplierId) throw new DomainError("SUPPLIER_REQUIRED_FOR_CREDIT");
  const bd = currentBusinessDate(state, ctx.branchId, ctx.now);
  const id = newId("gr");
  const grNo = `GR${bd.slice(2).replace(/-/g, "")}-${String(nextSeq(state, `gr:${ctx.branchId}:${bd}`)).padStart(3, "0")}`;
  const priceAlerts: { ingredientId: string; oldCost: number; newCost: number; pct: number }[] = [];
  let total = 0;
  for (const l of lines) {
    const ing = state.ingredients.find((i) => i.id === l.ingredientId);
    if (!ing) throw new DomainError("NOT_FOUND", { entity: "ingredient" });
    if (!(l.packQty > 0) || l.unitPrice < 0) throw new DomainError("INVALID_QTY", { name: ing.name });
    const unitCost = l.unitPrice / 100 / l.packQty;
    const old = ing.lastCost ?? ing.standardCost;
    if (old > 0 && unitCost > old * 1.05) {
      priceAlerts.push({ ingredientId: ing.id, oldCost: old, newCost: unitCost, pct: Math.round((unitCost / old - 1) * 1000) / 10 });
    }
    applyStock(state, ctx, ctx.branchId, ing.id, l.qtyPacks * l.packQty, "purchase", { unitCost, sourceId: id });
    ing.pack = { name: l.packName, qty: l.packQty, price: l.unitPrice, supplierId: input.supplierId ?? ing.pack?.supplierId };
    total += Math.round(l.qtyPacks * l.unitPrice);
  }
  state.receipts.unshift({ id, grNo, branchId: ctx.branchId, supplierId: input.supplierId, poId: input.poId, paymentMode: input.paymentMode, lines, total, at: ctx.now.toISOString(), priceAlerts });
  if (input.poId) {
    const po = state.purchaseOrders.find((p) => p.id === input.poId);
    if (po) {
      for (const l of lines) {
        const pl = po.lines.find((x) => x.ingredientId === l.ingredientId);
        if (pl) pl.receivedPacks += l.qtyPacks;
      }
      po.status = po.lines.every((x) => x.receivedPacks >= x.qtyPacks) ? "received" : "partially_received";
    }
  }
  if (input.paymentMode === "credit" && input.supplierId) {
    const sup = state.suppliers.find((s) => s.id === input.supplierId);
    state.bills.unshift({
      id: newId("bill"),
      supplierId: input.supplierId,
      billNo: grNo,
      date: bd,
      dueDate: addDays(bd, sup?.paymentTermsDays ?? 30),
      total,
      paid: 0,
      status: "open",
      sourceId: id,
    });
  }
  const supplier = state.suppliers.find((s) => s.id === input.supplierId)?.name;
  log(state, ctx, "inventory.goods_received", `${actorName(state, ctx.actorId)} รับของ ${lines.length} รายการ${supplier ? ` จาก ${supplier}` : ""} ฿${(total / 100).toLocaleString("th-TH")}`, "good");
  for (const a of priceAlerts) {
    const ing = state.ingredients.find((i) => i.id === a.ingredientId);
    log(state, ctx, "inventory.price_increased", `ราคา “${ing?.name}” ขึ้น ${a.pct}% จากครั้งก่อน`, "warn");
  }
  return { id, grNo, total, priceAlerts };
}

export function recordWaste(state: DemoState, ctx: Ctx, ingredientId: string, qty: number, reasonCode: string, note?: string) {
  requirePerm(state, ctx, "inventory.waste");
  const ing = state.ingredients.find((i) => i.id === ingredientId);
  if (!ing) throw new DomainError("NOT_FOUND");
  if (!(qty > 0)) throw new DomainError("INVALID_QTY");
  if (!WASTE_REASONS.some((r) => r.code === reasonCode)) throw new DomainError("INVALID_REASON");
  const value = -applyStock(state, ctx, ctx.branchId, ingredientId, -qty, "waste", { reasonCode, note });
  const reason = WASTE_REASONS.find((r) => r.code === reasonCode)!.th;
  log(state, ctx, "inventory.waste", `${actorName(state, ctx.actorId)} บันทึกของเสีย “${ing.name}” (${reason}) มูลค่า ฿${value.toFixed(2)}`, "warn");
  return value;
}

export function startCount(state: DemoState, ctx: Ctx) {
  requirePerm(state, ctx, "inventory.count");
  const open = state.counts.find((c) => c.branchId === ctx.branchId && c.status !== "approved");
  if (open) return open.id; // continue where you left off
  const bd = currentBusinessDate(state, ctx.branchId, ctx.now);
  const id = newId("cnt");
  const lines = state.ingredients
    .filter((i) => i.trackStock)
    .sort((a, b) => (a.zone ?? "~").localeCompare(b.zone ?? "~", "th") || a.countSort - b.countSort)
    .map((i) => ({ ingredientId: i.id, counted: null as number | null }));
  state.counts.unshift({
    id,
    branchId: ctx.branchId,
    countNo: `C${bd.slice(2).replace(/-/g, "")}-${String(nextSeq(state, `count:${ctx.branchId}:${bd}`)).padStart(2, "0")}`,
    status: "in_progress",
    blind: true,
    startedAt: ctx.now.toISOString(),
    startedBy: ctx.actorId ?? undefined,
    lines,
  });
  return id;
}

export function recordCount(state: DemoState, ctx: Ctx, countId: string, ingredientId: string, counted: number | null) {
  requirePerm(state, ctx, "inventory.count");
  const c = state.counts.find((x) => x.id === countId);
  if (!c) throw new DomainError("NOT_FOUND");
  if (c.status !== "in_progress") throw new DomainError("COUNT_NOT_IN_PROGRESS");
  if (counted !== null && counted < 0) throw new DomainError("INVALID_QTY");
  const line = c.lines.find((l) => l.ingredientId === ingredientId);
  if (line) line.counted = counted;
}

export function submitCount(state: DemoState, ctx: Ctx, countId: string) {
  requirePerm(state, ctx, "inventory.count");
  const c = state.counts.find((x) => x.id === countId);
  if (!c) throw new DomainError("NOT_FOUND");
  if (c.status !== "in_progress") throw new DomainError("COUNT_NOT_IN_PROGRESS");
  for (const l of c.lines) {
    const ing = state.ingredients.find((i) => i.id === l.ingredientId)!;
    l.expected = state.balances[balanceKey(c.branchId, l.ingredientId)]?.qty ?? 0;
    l.unitCost = unitCostOf(state, ing, c.branchId);
  }
  c.status = "submitted";
  c.submittedAt = ctx.now.toISOString();
  log(state, ctx, "inventory.count_submitted", `${actorName(state, ctx.actorId)} ส่งผลนับสต็อก ${c.countNo} (${c.lines.filter((l) => l.counted !== null).length} รายการ)`);
}

export function approveCount(state: DemoState, ctx: Ctx, countId: string) {
  requirePerm(state, ctx, "inventory.adjust");
  const c = state.counts.find((x) => x.id === countId);
  if (!c) throw new DomainError("NOT_FOUND");
  if (c.status !== "submitted") throw new DomainError("COUNT_NOT_SUBMITTED");
  let value = 0;
  let n = 0;
  for (const l of c.lines) {
    if (l.counted === null || l.expected === undefined) continue;
    const diff = roundQty(l.counted - l.expected);
    if (diff === 0) continue;
    value += applyStock(state, ctx, c.branchId, l.ingredientId, diff, "count_adjust", { sourceId: c.id, note: c.countNo });
    n += 1;
  }
  c.status = "approved";
  c.approvedAt = ctx.now.toISOString();
  log(state, ctx, "inventory.count_approved", `${actorName(state, ctx.actorId)} อนุมัติผลนับ ${c.countNo}: ปรับ ${n} รายการ ส่วนต่าง ฿${value.toFixed(2)}`, value < 0 ? "warn" : "good");
  return { adjusted: n, value };
}

// ---------------------------------------------------------------------------
// Purchasing
// ---------------------------------------------------------------------------
export function createPurchaseOrder(state: DemoState, ctx: Ctx, supplierId: string, lines: { ingredientId: string; qtyPacks: number }[]) {
  requirePerm(state, ctx, "purchasing.manage");
  const bd = currentBusinessDate(state, ctx.branchId, ctx.now);
  const poLines = lines
    .filter((l) => l.qtyPacks > 0)
    .map((l) => {
      const ing = state.ingredients.find((i) => i.id === l.ingredientId)!;
      return { ingredientId: ing.id, packName: ing.pack?.name ?? ing.baseUnit, packQty: ing.pack?.qty ?? 1, qtyPacks: l.qtyPacks, unitPrice: ing.pack?.price ?? 0, receivedPacks: 0 };
    });
  if (poLines.length === 0) throw new DomainError("LINES_REQUIRED");
  const po = {
    id: newId("po"),
    poNo: `PO${bd.slice(2, 4)}${bd.slice(5, 7)}-${String(nextSeq(state, `po:${bd.slice(0, 7)}`)).padStart(4, "0")}`,
    branchId: ctx.branchId,
    supplierId,
    status: memberCan(state, ctx.actorId, "purchasing.approve", ctx.branchId) || ctx.system ? ("approved" as const) : ("draft" as const),
    createdAt: ctx.now.toISOString(),
    expectedDate: addDays(bd, state.suppliers.find((s) => s.id === supplierId)?.leadTimeDays ?? 1),
    lines: poLines,
    total: poLines.reduce((s, l) => s + Math.round(l.qtyPacks * l.unitPrice), 0),
  };
  state.purchaseOrders.unshift(po);
  log(state, ctx, "purchasing.po_created", `${actorName(state, ctx.actorId)} สร้างใบสั่งซื้อ ${po.poNo} ฿${(po.total / 100).toLocaleString("th-TH")}`);
  return po;
}

export function setPurchaseOrderStatus(state: DemoState, ctx: Ctx, poId: string, status: "approved" | "sent" | "cancelled") {
  const po = state.purchaseOrders.find((p) => p.id === poId);
  if (!po) throw new DomainError("NOT_FOUND");
  requirePerm(state, ctx, status === "approved" ? "purchasing.approve" : "purchasing.manage");
  const ok = (status === "approved" && po.status === "draft") || (status === "sent" && po.status === "approved") || (status === "cancelled" && ["draft", "approved", "sent"].includes(po.status));
  if (!ok) throw new DomainError("INVALID_TRANSITION");
  po.status = status;
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------
export function closeDay(state: DemoState, ctx: Ctx, date: string) {
  requirePerm(state, ctx, "finance.close_day");
  if (state.dayCloses.some((d) => d.branchId === ctx.branchId && d.businessDate === date)) throw new DomainError("PERIOD_CLOSED", { business_date: date });
  const open = state.orders.filter((o) => o.branchId === ctx.branchId && o.businessDate === date && o.status === "open");
  if (open.length) throw new DomainError("OPEN_ORDERS_EXIST", { count: open.length });
  const shifts = state.shifts.filter((s) => s.branchId === ctx.branchId && s.status === "open");
  if (shifts.length) throw new DomainError("OPEN_SHIFTS_EXIST", { count: shifts.length });

  const orders = state.orders.filter((o) => o.branchId === ctx.branchId && o.businessDate === date && (o.status === "paid" || o.status === "refunded"));
  const byChannel = new Map<string, { total: number; orders: number; payout: number }>();
  const byMethod = new Map<string, number>();
  for (const o of orders) {
    const c = byChannel.get(o.channelId) ?? { total: 0, orders: 0, payout: 0 };
    c.total += o.totals.total;
    c.orders += 1;
    // Platforms pay out the bill minus the GP recorded at sale time (and VAT on the GP).
    if (o.status === "paid") c.payout += o.totals.total - o.totals.commission - o.totals.commissionVat;
    byChannel.set(o.channelId, c);
    for (const p of o.payments) byMethod.set(p.methodId, (byMethod.get(p.methodId) ?? 0) + (p.kind === "payment" ? p.amount : -p.amount));
  }
  const cashVariance = state.shifts.filter((s) => s.branchId === ctx.branchId && s.businessDate === date).reduce((s, x) => s + (x.variance ?? 0), 0);
  const summary = {
    orders: orders.length,
    total: orders.reduce((s, o) => s + o.totals.total, 0),
    netSales: orders.reduce((s, o) => s + o.totals.netSales, 0),
    vat: orders.reduce((s, o) => s + o.totals.vatAmount, 0),
    byChannel: [...byChannel].map(([channelId, v]) => ({ channelId, total: v.total, orders: v.orders })),
    byMethod: [...byMethod].map(([methodId, total]) => ({ methodId, total })),
    cashVariance,
  };
  state.dayCloses.push({ branchId: ctx.branchId, businessDate: date, closedAt: ctx.now.toISOString(), closedBy: ctx.actorId ?? undefined, summary });

  // Money we expect in the bank: card batch and each delivery platform payout.
  for (const [methodId, total] of byMethod) {
    const m = state.paymentMethods.find((x) => x.id === methodId);
    if (!m || m.kind !== "card" || total <= 0) continue;
    state.expected.push({ id: newId("exp"), branchId: ctx.branchId, label: `บัตร ${date.slice(8)}/${date.slice(5, 7)}`, expectedDate: addDays(date, m.settlementDays), amount: total - applyRate(total, m.feeRate), sourceType: "card_batch", status: "open" });
  }
  for (const [channelId, v] of byChannel) {
    const ch = state.channels.find((c) => c.id === channelId);
    if (!ch || ch.kind !== "delivery_platform" || v.payout <= 0) continue;
    state.expected.push({ id: newId("exp"), branchId: ctx.branchId, label: `${ch.name} ${date.slice(8)}/${date.slice(5, 7)}`, expectedDate: addDays(date, ch.settlementDays), amount: v.payout, sourceType: "platform_payout", status: "open" });
  }
  log(state, ctx, "finance.day_closed", `${actorName(state, ctx.actorId)} ปิดยอดวันที่ ${date} ยอดขาย ฿${(summary.total / 100).toLocaleString("th-TH")} (${summary.orders} บิล)`, "good");
  return summary;
}

export function addExpense(state: DemoState, ctx: Ctx, e: Omit<Expense, "id">) {
  requirePerm(state, ctx, "finance.manage");
  if (!(e.amount > 0)) throw new DomainError("INVALID_AMOUNT");
  if (!e.description.trim()) throw new DomainError("VALIDATION", { field: "description" });
  state.expenses.unshift({ ...e, id: newId("xp") });
  log(state, ctx, "finance.expense", `${actorName(state, ctx.actorId)} บันทึกค่าใช้จ่าย “${e.description}” ฿${(e.amount / 100).toLocaleString("th-TH")}`);
}

export function payBill(state: DemoState, ctx: Ctx, billId: string, amount: Satang) {
  requirePerm(state, ctx, "finance.manage");
  const b = state.bills.find((x) => x.id === billId);
  if (!b) throw new DomainError("NOT_FOUND");
  if (b.status === "paid") throw new DomainError("BILL_NOT_PAYABLE");
  if (!(amount > 0) || amount > b.total - b.paid) throw new DomainError("INVALID_AMOUNT");
  b.paid += amount;
  b.status = b.paid >= b.total ? "paid" : "partially_paid";
  log(state, ctx, "finance.bill_paid", `${actorName(state, ctx.actorId)} จ่ายบิล ${b.billNo} ฿${(amount / 100).toLocaleString("th-TH")}`, "good");
}

export function matchStatementLine(state: DemoState, ctx: Ctx, lineId: string, expectedIds: string[], note?: string) {
  requirePerm(state, ctx, "finance.reconcile");
  const line = state.statementLines.find((l) => l.id === lineId);
  if (!line) throw new DomainError("NOT_FOUND");
  if (line.status !== "unmatched") throw new DomainError("LINE_ALREADY_MATCHED");
  const exp = state.expected.filter((e) => expectedIds.includes(e.id) && e.status === "open");
  const variance = line.amount - exp.reduce((s, e) => s + e.amount, 0);
  for (const e of exp) e.status = "matched";
  line.status = "matched";
  line.matchedIds = exp.map((e) => e.id);
  line.variance = variance;
  log(state, ctx, "finance.reconciled", `${actorName(state, ctx.actorId)} กระทบยอด “${line.description}”${variance ? ` ส่วนต่าง ฿${(variance / 100).toFixed(2)}${note ? ` (${note})` : ""}` : " ตรงพอดี"}`, variance ? "warn" : "good");
}

export function ignoreStatementLine(state: DemoState, ctx: Ctx, lineId: string) {
  requirePerm(state, ctx, "finance.reconcile");
  const line = state.statementLines.find((l) => l.id === lineId);
  if (line) line.status = "ignored";
}

// ---------------------------------------------------------------------------
// Team & settings
// ---------------------------------------------------------------------------
export function addMember(state: DemoState, ctx: Ctx, input: { name: string; roleKey: string; pin: string; branchIds: "all" | string[]; maxDiscountRate?: number }): Member {
  requirePerm(state, ctx, "staff.manage");
  if (!input.name.trim()) throw new DomainError("VALIDATION", { field: "name" });
  if (!/^\d{4,6}$/.test(input.pin)) throw new DomainError("PIN_FORMAT");
  if (state.members.some((m) => m.active && m.pin === input.pin)) throw new DomainError("PIN_IN_USE");
  if (!state.roles.some((r) => r.key === input.roleKey)) throw new DomainError("VALIDATION", { field: "role" });
  const colors = ["emerald", "sky", "amber", "rose", "indigo", "orange", "violet"];
  const m: Member = { id: newId("m"), name: input.name.trim(), roleKey: input.roleKey, pin: input.pin, branchIds: input.branchIds, maxDiscountRate: input.maxDiscountRate, color: colors[state.members.length % colors.length]!, active: true };
  state.members.push(m);
  log(state, ctx, "team.member_added", `${actorName(state, ctx.actorId)} เพิ่มพนักงาน “${m.name}” (${state.roles.find((r) => r.key === m.roleKey)?.name})`, "good");
  return m;
}

export function setRolePermissions(state: DemoState, ctx: Ctx, roleKey: string, permissions: string[]) {
  requirePerm(state, ctx, "staff.manage");
  const role = state.roles.find((r) => r.key === roleKey);
  if (!role || role.grantsAll) throw new DomainError("PERMISSION_DENIED");
  role.permissions = permissions;
  log(state, ctx, "team.role_changed", `${actorName(state, ctx.actorId)} ปรับสิทธิ์ตำแหน่ง “${role.name}”`, "warn");
}

/** Finds the member whose PIN this is (shared-device user switch). */
export function memberByPin(state: DemoState, pin: string, branchId: string): Member {
  const m = state.members.find((x) => x.active && x.pin === pin);
  if (!m || (m.branchIds !== "all" && !m.branchIds.includes(branchId))) throw new DomainError("PIN_INVALID");
  return m;
}

/** Manager approval by PIN for one permission. */
export function approverByPin(state: DemoState, pin: string, permission: Permission, branchId: string): Member {
  const m = state.members.find((x) => x.active && x.pin === pin);
  if (!m) throw new DomainError("APPROVAL_PIN_INVALID");
  if (!memberCan(state, m.id, permission, branchId)) throw new DomainError("APPROVER_NOT_ALLOWED", { permission });
  return m;
}
