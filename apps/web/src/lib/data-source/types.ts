/**
 * The single contract every page programs against (ADR-0009). A page never
 * calls the demo engine or an HTTP endpoint directly — it reads `DemoState`
 * from the shared store and calls `DataSource` methods to change it. Two
 * implementations satisfy this interface: `DemoDataSource` (wraps
 * `apps/web/src/lib/demo/engine.ts` in the existing Zustand+Immer store,
 * unchanged behaviour) and `HttpDataSource` (calls the API and refreshes the
 * affected slice of the store from the server's response).
 *
 * Every method here has a one-to-one match with either a demo engine command
 * (`apps/web/src/lib/demo/engine.ts`) or a V1.1 API endpoint — see the
 * "บันทึกการสำรวจก่อนเริ่ม 3.1" note in docs/v1.1-checklist.md for the mapping.
 * Two capabilities exist only on the API side (from_suggestions PO creation,
 * a channel GP change with an effective date); DemoDataSource approximates
 * them on top of existing demo commands, documented at each method.
 */
import type {
  Branch,
  Channel,
  DayClose,
  Expense,
  GoodsReceipt,
  Ingredient,
  Member,
  MenuItem,
  PaymentMethod,
  PurchaseOrder,
  Shift,
  StockCount,
  Tenant,
  Ticket,
} from "../demo/types";
import type {
  NewIngredientInput,
  NewMenuItemInput,
  PaymentInput,
  ReceiveInput,
  SubmitOrderInput,
} from "../demo/engine";
import type { PlanCode, Recipe, Satang } from "@sabai/domain";

/** Opaque approval proof: a member id in demo mode, a one-time `approvalId` from the API in API mode. */
export interface ApprovalToken {
  value: string;
}

/**
 * A named slice of the store a page can ask to (re)load. `bootstrap` covers
 * everything read-mostly (settings, branches, catalog, roles, team, plan —
 * matches `GET /v1/shop`); the rest are the things that change during a
 * shift and get reloaded after a relevant command or SSE event.
 */
export type Slice =
  | "bootstrap"
  | "orders"
  | "tickets"
  | "stock"
  | "shifts"
  | "purchasing"
  | "finance"
  | "team"
  | "settings"
  | "reports";

export interface ReportFilter {
  from: string;
  to: string;
  branchId?: string;
}

/** Same shape as `apps/web/src/lib/demo/selectors.ts`'s `reportSummary()` and the API's `GET /v1/reports/summary`. */
export interface ReportSummary {
  totals: { orders: number; netSales: number; cost: number; commission: number; fees: number; waste: number; variance: number; expenses: number; avgTicket: number };
  waterfall: { key: string; label: string; value: number; running: number }[];
  channels: { channelId: string; name: string; orders: number; netSales: number; avgTicket: number; shareOfSales: number; contribution: number; marginPct: number; commission: number }[];
  items: { menuItemId: string; name: string; qty: number; sales: number; contributionPerItem: number; class: string }[];
  days: { date: string; netSales: number; contribution: number; orders: number }[];
  hours: number[];
  branches: { id: string; name: string; netSales: number; orders: number; contribution: number }[];
}

/** Same shape as `selectors.ts`'s `todayStats()` and the API's `GET /v1/reports/today`. */
export interface TodayStats {
  today: string;
  sales: Satang;
  orders: number;
  avgTicket: Satang;
  keep: Satang;
  keepPct: number;
  lastWeekSales: Satang;
  lastWeekOrders: number;
  spark: Satang[];
  open: number;
}

export interface DataSource {
  // ------------------------------------------------------------- loaders
  /** (Re)loads one or more slices of the shared `DemoState` store from the source of truth. A no-op in demo mode. */
  load(slices: Slice[]): Promise<void>;

  // ------------------------------------------------------------- session
  signIn(memberId: string, branchId?: string): Promise<void>;
  signOut(): Promise<void>;
  setBranch(branchId: string): Promise<void>;
  /** Switch the active user on a shared device by PIN. Returns the member switched to. */
  pinSwitch(branchId: string, pin: string): Promise<Member>;
  /** A manager approves a sensitive action by PIN. The token is passed to the command that needed it. */
  approve(permission: string, pin: string, target?: { type: string; id: string }, reason?: string): Promise<ApprovalToken>;

  // ------------------------------------------------------------- POS / shifts
  openShift(openingFloat: Satang): Promise<Shift>;
  cashMove(kind: "pay_in" | "pay_out", amount: Satang, reason: string): Promise<void>;
  closeShift(counted: Satang): Promise<Shift>;
  submitOrder(input: SubmitOrderInput): Promise<void>;
  applyDiscount(orderId: string, type: "percent" | "amount", value: number, reason: string, approval?: ApprovalToken): Promise<void>;
  voidItem(orderId: string, itemId: string, reason: string, approval?: ApprovalToken): Promise<void>;
  voidOrder(orderId: string, reason: string, approval?: ApprovalToken): Promise<void>;
  payOrder(orderId: string, payments: PaymentInput[]): Promise<void>;
  refundOrder(orderId: string, reason: string, restock: boolean, approval?: ApprovalToken): Promise<void>;

  // ------------------------------------------------------------- kitchen
  setTicketStatus(ticketId: string, status: Ticket["status"]): Promise<void>;
  /** Marks one item on a ticket done/not-done without bumping the rest of the ticket. */
  toggleTicketItem(ticketId: string, orderItemId: string): Promise<void>;

  // ------------------------------------------------------------- menu
  setSoldOut(menuItemId: string, soldOut: boolean): Promise<void>;
  addMenuItem(input: NewMenuItemInput): Promise<MenuItem>;
  updateMenuItem(id: string, patch: Partial<Pick<MenuItem, "price" | "name" | "active" | "emoji">> & { recipe?: Recipe }): Promise<void>;

  // ------------------------------------------------------------- inventory
  addIngredient(input: NewIngredientInput): Promise<Ingredient>;
  receiveGoods(input: ReceiveInput): Promise<GoodsReceipt>;
  recordWaste(ingredientId: string, qty: number, reasonCode: string, note?: string): Promise<void>;
  startCount(): Promise<StockCount>;
  recordCount(countId: string, ingredientId: string, counted: number | null): Promise<void>;
  submitCount(countId: string): Promise<void>;
  approveCount(countId: string): Promise<void>;

  // ------------------------------------------------------------- purchasing
  createPurchaseOrder(supplierId: string, lines: { ingredientId: string; qtyPacks: number }[]): Promise<PurchaseOrder>;
  /**
   * Turns the reorder-suggestions list into a draft PO for one supplier in one
   * call — API-only capability (`POST /v1/purchase-orders/from-suggestions`).
   * DemoDataSource approximates it by reading the same suggestions the
   * purchasing page already shows and calling `createPurchaseOrder`.
   */
  createPOFromSuggestions(branchId: string, supplierId: string, ingredientIds?: string[]): Promise<PurchaseOrder>;
  setPurchaseOrderStatus(poId: string, status: "approved" | "sent" | "cancelled"): Promise<void>;

  // ------------------------------------------------------------- finance
  closeDay(date: string): Promise<DayClose>;
  addExpense(expense: Omit<Expense, "id">): Promise<Expense>;
  payBill(billId: string, amount: Satang): Promise<void>;
  matchStatementLine(lineId: string, expectedIds: string[], note?: string): Promise<void>;
  ignoreStatementLine(lineId: string): Promise<void>;

  // ------------------------------------------------------------- team
  addMember(input: { name: string; roleKey: string; pin: string; branchIds: "all" | string[]; maxDiscountRate?: number }): Promise<Member>;
  updateMember(id: string, patch: Partial<Pick<Member, "name" | "roleKey" | "branchIds" | "maxDiscountRate" | "active">>): Promise<void>;
  resetMemberPin(id: string, pin: string): Promise<void>;
  setRolePermissions(roleKey: string, permissions: string[]): Promise<void>;

  // ------------------------------------------------------------- settings
  updateTenant(patch: Partial<Pick<Tenant, "name" | "businessType" | "vatRegistered" | "pricesIncludeVat" | "cashRounding">>): Promise<void>;
  addBranch(input: { name: string; address?: string; phone?: string }): Promise<Branch>;
  updateBranch(id: string, patch: Partial<Pick<Branch, "name" | "address" | "phone" | "dayCutoff" | "serviceChargeRate">>): Promise<void>;
  updateChannel(id: string, patch: Partial<Pick<Channel, "active" | "appliesServiceCharge">> & { name?: string; color?: string }): Promise<void>;
  /**
   * Sets a channel's GP effective from a given date (the old rate keeps
   * applying to sales before it) — API-only (`POST /v1/channels/{id}/commission-rate`).
   * DemoDataSource approximates it with `updateChannel({ commissionRate })`
   * applied immediately, since the demo doesn't model historical rate changes.
   */
  setChannelCommission(id: string, rate: number, validFrom: string, note?: string): Promise<void>;
  updatePaymentMethod(id: string, patch: Partial<Pick<PaymentMethod, "active" | "promptpayId" | "feeRate">>): Promise<void>;
  skipOnboardingStep(key: string): Promise<void>;
  confirmCashOnly(): Promise<void>;
  changePlan(plan: PlanCode): Promise<void>;

  // ------------------------------------------------------------- queries
  reportSummary(filter: ReportFilter): Promise<ReportSummary>;
  today(branchId: string | null): Promise<TodayStats>;
}
