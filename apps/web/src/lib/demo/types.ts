/**
 * In-browser data model for the interactive demo. It mirrors the database
 * (supabase/migrations) closely enough that each command in engine.ts maps to
 * one API endpoint — swapping the demo adapter for the HTTP client is a
 * data-source change, not a UI rewrite.
 */
import type { OrderTotals, Recipe, RoleKey, Satang, StockReason } from "@sabai/domain";

export type ID = string;

export interface Tenant {
  name: string;
  businessType: "cafe" | "restaurant" | "bar" | "bakery" | "cloud_kitchen" | "food_truck" | "buffet" | "other";
  vatRegistered: boolean;
  pricesIncludeVat: boolean;
  vatRate: number;
  cashRounding: "none" | "0.25" | "1.00";
  plan: "free" | "starter" | "pro" | "business" | "enterprise";
  trialEndsAt: string;
  onboarding: { skipped: string[]; paymentsConfirmed: boolean };
}

export interface Branch {
  id: ID;
  code: string;
  name: string;
  address?: string;
  phone?: string;
  openingHours?: string;
  dayCutoff: string;
  serviceChargeRate: number;
  tables: { id: ID; name: string; seats: number; zone: string }[];
  /** API only: the branch's default stock location, where waste, counts and opening stock are recorded. */
  stockLocationId?: ID;
}

export interface Station {
  id: ID;
  branchId: ID;
  name: string;
  route: string;
  warnAfterSec: number;
  lateAfterSec: number;
}

export type ChannelKind = "dine_in" | "takeaway" | "delivery_platform" | "own_delivery";

export interface Channel {
  id: ID;
  key: string;
  kind: ChannelKind;
  name: string;
  short: string;
  color: string;
  active: boolean;
  commissionRate: number;
  /** Delivery menus are often priced higher to absorb GP. */
  priceMarkup: number;
  appliesServiceCharge: boolean;
  settlementDays: number;
}

export type PaymentKind = "cash" | "promptpay" | "card" | "ewallet" | "platform";

export interface PaymentMethod {
  id: ID;
  kind: PaymentKind;
  name: string;
  active: boolean;
  feeRate: number;
  promptpayId?: string;
  requiresReference: boolean;
  settlementDays: number;
}

export interface Supplier {
  id: ID;
  name: string;
  phone?: string;
  lineId?: string;
  paymentTermsDays: number;
  leadTimeDays: number;
}

export interface Ingredient {
  id: ID;
  name: string;
  emoji: string;
  baseUnit: "g" | "ml" | "pcs";
  displayUnit?: string;
  kind: "raw" | "prep" | "packaging" | "merchandise";
  trackStock: boolean;
  category: string;
  reorderPoint?: number;
  parLevel?: number;
  standardCost: number;
  lastCost?: number;
  zone?: string;
  countSort: number;
  highValue?: boolean;
  /** How it is usually bought (smart default for receiving). */
  pack?: { name: string; qty: number; price: Satang; supplierId?: ID };
}

export interface MenuCategory {
  id: ID;
  name: string;
  emoji: string;
  color: string;
  sort: number;
}

export interface ModifierOption {
  id: ID;
  name: string;
  priceDelta: Satang;
  recipe?: Recipe;
}

export interface ModifierGroup {
  id: ID;
  name: string;
  min: number;
  max: number;
  options: ModifierOption[];
}

export interface MenuItem {
  id: ID;
  categoryId: ID;
  name: string;
  nameEn?: string;
  emoji: string;
  price: Satang;
  route: string;
  modifierGroupIds: ID[];
  recipe?: Recipe;
  active: boolean;
  soldOut: Record<ID, boolean>;
  /** Relative popularity used by the history generator. */
  weight: number;
  tags?: string[];
}

export interface Role {
  key: RoleKey | string;
  name: string;
  description: string;
  grantsAll: boolean;
  home: string;
  color: string;
  permissions: string[];
  custom?: boolean;
}

export interface Member {
  id: ID;
  name: string;
  nickname?: string;
  roleKey: string;
  pin: string;
  branchIds: "all" | ID[];
  maxDiscountRate?: number;
  color: string;
  active: boolean;
}

export interface Movement {
  id: ID;
  branchId: ID;
  ingredientId: ID;
  qty: number;
  unitCost: number;
  reason: StockReason;
  reasonCode?: string;
  at: string;
  by?: ID;
  note?: string;
  sourceId?: ID;
  businessDate: string;
}

export interface OrderItemModifier {
  id: ID;
  name: string;
  priceDelta: Satang;
}

export interface OrderItem {
  id: ID;
  menuItemId: ID;
  name: string;
  emoji: string;
  qty: number;
  unitPrice: Satang;
  modifiers: OrderItemModifier[];
  note?: string;
  status: "pending" | "sent" | "ready" | "served" | "voided";
  voidReason?: string;
  cost?: number;
}

export interface Payment {
  id: ID;
  methodId: ID;
  kind: "payment" | "refund";
  amount: Satang;
  tendered?: Satang;
  change: Satang;
  fee: Satang;
  reference?: string;
  at: string;
}

export interface Order {
  id: ID;
  branchId: ID;
  channelId: ID;
  tableId?: ID;
  orderNo: string;
  receiptNo?: string;
  status: "open" | "paid" | "voided" | "refunded";
  businessDate: string;
  openedAt: string;
  paidAt?: string;
  openedBy?: ID;
  guestCount?: number;
  note?: string;
  items: OrderItem[];
  discount?: { type: "percent" | "amount"; value: number; reason: string; approvedBy?: ID };
  payments: Payment[];
  totals: OrderTotals;
  commissionRate: number;
  cost?: number;
  shiftId?: ID;
}

export interface TicketItem {
  /** The ticket line's own id — only the API has one (the demo finds a line by `orderItemId`). */
  id?: ID;
  orderItemId: ID;
  name: string;
  qty: number;
  modifiers: string;
  note?: string;
  status: "pending" | "done" | "voided";
}

export interface Ticket {
  id: ID;
  branchId: ID;
  orderId: ID;
  stationId: ID;
  ticketNo: string;
  status: "new" | "in_progress" | "ready" | "cancelled";
  firedAt: string;
  startedAt?: string;
  readyAt?: string;
  items: TicketItem[];
  channelName: string;
  channelKind: ChannelKind;
  tableName?: string;
}

export interface Shift {
  id: ID;
  branchId: ID;
  openedBy: ID;
  openedAt: string;
  openingFloat: Satang;
  status: "open" | "closed";
  closedAt?: string;
  countedCash?: Satang;
  expectedCash?: Satang;
  variance?: Satang;
  cashMoves: { id: ID; kind: "pay_in" | "pay_out"; amount: Satang; reason: string; at: string }[];
  businessDate: string;
}

export interface StockCount {
  id: ID;
  branchId: ID;
  countNo: string;
  status: "in_progress" | "submitted" | "approved";
  blind: boolean;
  startedAt: string;
  startedBy?: ID;
  submittedAt?: string;
  approvedAt?: string;
  lines: { ingredientId: ID; expected?: number; counted: number | null; unitCost?: number }[];
}

export interface PurchaseOrderLine {
  /** Only known when the order comes from the API: receiving against the order names its lines. */
  id?: ID;
  ingredientId: ID;
  packName: string;
  packQty: number;
  qtyPacks: number;
  unitPrice: Satang;
  receivedPacks: number;
}

export interface PurchaseOrder {
  id: ID;
  poNo: string;
  branchId: ID;
  supplierId: ID;
  status: "draft" | "approved" | "sent" | "partially_received" | "received" | "cancelled";
  createdAt: string;
  expectedDate?: string;
  lines: PurchaseOrderLine[];
  total: Satang;
}

export interface GoodsReceipt {
  id: ID;
  grNo: string;
  branchId: ID;
  supplierId?: ID;
  poId?: ID;
  paymentMode: "credit" | "cash_paid" | "transfer_paid";
  lines: { ingredientId: ID; packName: string; packQty: number; qtyPacks: number; unitPrice: Satang }[];
  total: Satang;
  at: string;
  priceAlerts: { ingredientId: ID; oldCost: number; newCost: number; pct: number }[];
}

export interface DayClose {
  branchId: ID;
  businessDate: string;
  closedAt: string;
  closedBy?: ID;
  summary: {
    orders: number;
    total: Satang;
    netSales: Satang;
    vat: Satang;
    byChannel: { channelId: ID; total: Satang; orders: number }[];
    byMethod: { methodId: ID; total: Satang }[];
    cashVariance: Satang;
  };
}

export interface Expense {
  id: ID;
  branchId?: ID;
  date: string;
  category: "rent" | "salaries" | "utilities" | "marketing" | "supplies" | "repairs" | "other";
  description: string;
  amount: Satang;
  paidFrom: "cash_on_hand" | "bank" | "credit";
  /** Service period (e.g. the month rent covers); reports spread the amount over it. */
  periodStart?: string;
  periodEnd?: string;
}

export interface Bill {
  id: ID;
  supplierId: ID;
  billNo: string;
  date: string;
  dueDate: string;
  total: Satang;
  paid: Satang;
  status: "open" | "partially_paid" | "paid";
  sourceId?: ID;
}

export interface ExpectedReceipt {
  id: ID;
  branchId: ID;
  label: string;
  expectedDate: string;
  amount: Satang;
  sourceType: "card_batch" | "payment" | "platform_payout";
  /** Who pays it out (card acquirer, platform) — only same-payer receipts combine. */
  payer?: string;
  status: "open" | "matched";
}

export interface StatementLine {
  id: ID;
  date: string;
  amount: Satang;
  description: string;
  status: "unmatched" | "matched" | "ignored";
  matchedIds?: ID[];
  variance?: Satang;
}

export interface ActivityEvent {
  id: ID;
  at: string;
  type: string;
  actorId?: ID;
  branchId?: ID;
  text: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  /** What the event was about, for events that other screens act on (a price rise names its ingredient). */
  data?: { ingredientId?: string; pct?: number };
}

export interface DemoState {
  version: number;
  seededFor: string;
  mode: "demo" | "fresh";
  tenant: Tenant;
  branches: Branch[];
  stations: Station[];
  channels: Channel[];
  paymentMethods: PaymentMethod[];
  suppliers: Supplier[];
  ingredients: Ingredient[];
  prepRecipes: Record<ID, Recipe>;
  menuCategories: MenuCategory[];
  menuItems: MenuItem[];
  modifierGroups: ModifierGroup[];
  roles: Role[];
  members: Member[];
  balances: Record<string, { qty: number; avgCost: number }>;
  movements: Movement[];
  orders: Order[];
  tickets: Ticket[];
  shifts: Shift[];
  counts: StockCount[];
  purchaseOrders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  dayCloses: DayClose[];
  expenses: Expense[];
  bills: Bill[];
  expected: ExpectedReceipt[];
  statementLines: StatementLine[];
  activity: ActivityEvent[];
  seq: Record<string, number>;
}

export interface Session {
  memberId: ID | null;
  branchId: ID | null;
}
