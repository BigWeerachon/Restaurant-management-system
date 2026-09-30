/**
 * Wraps the existing demo engine (`apps/web/src/lib/demo/engine.ts`) and its
 * Zustand+Immer store (`apps/web/src/lib/demo/store.ts`) behind the
 * `DataSource` interface. Every method delegates to `useSabai.getState().run(...)`
 * exactly as pages do today — no behaviour change, so the existing demo test
 * suite (`apps/web/src/lib/demo/demo.test.ts`) still covers it.
 */
import type { Permission } from "@sabai/domain";
import * as engine from "../demo/engine";
import { getHistory, useSabai } from "../demo/store";
import { reportSummary as selectReportSummary, stockRows, todayStats as selectTodayStats } from "../demo/selectors";
import type { DataSource, ReportFilter, ReportSummary, Slice, TodayStats } from "./types";

function run<T>(fn: (draft: import("../demo/types").DemoState, ctx: engine.Ctx) => T, opts?: { asMember?: string }): Promise<T> {
  return useSabai.getState().run(fn, opts);
}

export const demoDataSource: DataSource = {
  // ------------------------------------------------------------- loaders
  async load(_slices: Slice[]) {
    // The demo store already holds everything in memory; nothing to fetch.
  },

  // ------------------------------------------------------------- session
  async signIn(memberId, branchId) {
    useSabai.getState().signIn(memberId, branchId);
  },
  async signOut() {
    useSabai.getState().signOut();
  },
  async setBranch(branchId) {
    useSabai.getState().setBranch(branchId);
  },
  async pinSwitch(branchId, pin) {
    const { db } = useSabai.getState();
    const member = engine.memberByPin(db, pin, branchId);
    useSabai.getState().signIn(member.id, branchId);
    return member;
  },
  async signInAsAccount() {
    const { db } = useSabai.getState();
    const owner = db.members.find((m) => db.roles.find((r) => r.key === m.roleKey)?.grantsAll) ?? db.members[0]!;
    useSabai.getState().signIn(owner.id, db.branches[0]?.id);
    return owner;
  },
  async approve(permission, pin, _target, _reason) {
    const { db, session } = useSabai.getState();
    const branchId = session.branchId ?? db.branches[0]!.id;
    const approver = engine.approverByPin(db, pin, permission as Permission, branchId);
    return { value: approver.id };
  },

  // ------------------------------------------------------------- POS / shifts
  openShift: (openingFloat) => run((d, c) => engine.openShift(d, c, openingFloat)),
  cashMove: (kind, amount, reason) => run((d, c) => engine.cashMove(d, c, kind, amount, reason)),
  closeShift: (counted) => run((d, c) => engine.closeShift(d, c, counted)),
  async submitOrder(input) {
    await run((d, c) => engine.submitOrder(d, c, input));
    return { queued: false };
  },
  applyDiscount: (orderId, type, value, reason, approval) => run((d, c) => engine.applyDiscount(d, c, orderId, type, value, reason, approval?.value)),
  voidItem: (orderId, itemId, reason, approval) => run((d, c) => engine.voidItem(d, c, orderId, itemId, reason, approval?.value)),
  voidOrder: (orderId, reason, approval) => run((d, c) => engine.voidOrder(d, c, orderId, reason, approval?.value)),
  async payOrder(orderId, payments) {
    await run((d, c) => engine.payOrder(d, c, orderId, payments));
    return { queued: false };
  },
  refundOrder: (orderId, reason, restock, approval) => run((d, c) => engine.refundOrder(d, c, orderId, reason, restock, approval?.value)),
  issueTaxInvoice: (orderId, buyer) => run((d, c) => engine.issueTaxInvoice(d, c, orderId, buyer)),
  async getTaxInvoice(orderId) {
    return useSabai.getState().db.taxInvoices.find((i) => i.orderId === orderId) ?? null;
  },

  // ------------------------------------------------------------- kitchen
  setTicketStatus: (ticketId, status) => run((d, c) => engine.setTicketStatus(d, c, ticketId, status)),
  toggleTicketItem: (ticketId, orderItemId) => run((d, c) => engine.toggleTicketItem(d, c, ticketId, orderItemId)),

  // ------------------------------------------------------------- menu
  setSoldOut: (menuItemId, soldOut) => run((d, c) => engine.setSoldOut(d, c, menuItemId, soldOut)),
  addMenuItem: (input) => run((d, c) => engine.addMenuItem(d, c, input)),
  updateMenuItem: (id, patch) => run((d, c) => engine.updateMenuItem(d, c, id, patch)),

  // ------------------------------------------------------------- inventory
  addIngredient: (input) => run((d, c) => engine.addIngredient(d, c, input)),
  receiveGoods: (input) => run((d, c) => engine.receiveGoods(d, c, input)),
  recordWaste: (ingredientId, qty, reasonCode, note) => run((d, c) => engine.recordWaste(d, c, ingredientId, qty, reasonCode, note)),
  startCount: () => run((d, c) => engine.startCount(d, c)),
  recordCount: (countId, ingredientId, counted) => run((d, c) => engine.recordCount(d, c, countId, ingredientId, counted)),
  submitCount: (countId) => run((d, c) => engine.submitCount(d, c, countId)),
  approveCount: (countId) => run((d, c) => engine.approveCount(d, c, countId)),

  // ------------------------------------------------------------- purchasing
  createPurchaseOrder: (supplierId, lines) => run((d, c) => engine.createPurchaseOrder(d, c, supplierId, lines)),
  async createPOFromSuggestions(branchId, supplierId, ingredientIds) {
    const { db } = useSabai.getState();
    const rows = stockRows(db, branchId).filter(
      (r) => r.suggestion && r.ingredient.pack?.supplierId === supplierId && (!ingredientIds || ingredientIds.includes(r.ingredient.id)),
    );
    if (!rows.length) throw new engine.DomainError("VALIDATION", { _: "ไม่มีรายการที่ต้องสั่งจากผู้ขายรายนี้" });
    const lines = rows.map((r) => ({ ingredientId: r.ingredient.id, qtyPacks: r.suggestion!.packs }));
    return run((d, c) => engine.createPurchaseOrder(d, c, supplierId, lines));
  },
  setPurchaseOrderStatus: (poId, status) => run((d, c) => engine.setPurchaseOrderStatus(d, c, poId, status)),

  // ------------------------------------------------------------- finance
  closeDay: (date) => run((d, c) => engine.closeDay(d, c, date)),
  async addExpense(expense) {
    await run((d, c) => engine.addExpense(d, c, expense));
  },
  async payBill(billId, amount) {
    await run((d, c) => engine.payBill(d, c, billId, amount));
  },
  async matchStatementLine(lineId, expectedIds, note) {
    await run((d, c) => engine.matchStatementLine(d, c, lineId, expectedIds, note));
  },
  async ignoreStatementLine(lineId) {
    await run((d, c) => engine.ignoreStatementLine(d, c, lineId));
  },

  // ------------------------------------------------------------- team
  addMember: (input) => run((d, c) => engine.addMember(d, c, input)),
  async updateMember(id, patch) {
    await run((d, c) => engine.updateMember(d, c, id, patch));
  },
  async resetMemberPin(id, pin) {
    await run((d, c) => engine.resetMemberPin(d, c, id, pin));
  },
  async setRolePermissions(roleKey, permissions) {
    await run((d, c) => engine.setRolePermissions(d, c, roleKey, permissions));
  },

  // ------------------------------------------------------------- settings
  async updateTenant(patch) {
    await run((d, c) => engine.updateTenant(d, c, patch));
  },
  addBranch: (input) => run((d, c) => engine.addBranch(d, c, input)),
  async updateBranch(id, patch) {
    await run((d, c) => engine.updateBranch(d, c, id, patch));
  },
  async updateChannel(id, patch) {
    await run((d, c) => engine.updateChannel(d, c, id, patch));
  },
  async setChannelCommission(id, rate, _validFrom, _note) {
    // The demo has no concept of a dated GP change — it just applies the new rate now.
    await run((d, c) => engine.updateChannel(d, c, id, { commissionRate: rate }));
  },
  async updatePaymentMethod(id, patch) {
    await run((d, c) => engine.updatePaymentMethod(d, c, id, patch));
  },
  async skipOnboardingStep(key) {
    await run((d, c) => engine.skipOnboardingStep(d, c, key));
  },
  async confirmCashOnly() {
    await run((d, c) => engine.confirmCashOnly(d, c));
  },
  async changePlan(plan) {
    await run((d, c) => engine.changePlan(d, c, plan));
  },

  // ------------------------------------------------------------- queries
  async reportSummary(filter: ReportFilter): Promise<ReportSummary> {
    const { db } = useSabai.getState();
    return selectReportSummary(db, getHistory(db), filter);
  },
  async today(branchId: string | null): Promise<TodayStats> {
    const { db } = useSabai.getState();
    return selectTodayStats(db, getHistory(db), branchId, new Date());
  },
};
