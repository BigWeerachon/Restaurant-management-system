import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { amountBeforeVat, businessDate } from "@sabai/domain";
import * as E from "./engine";
import { freshState } from "./seed";
import type { DemoState, TaxInvoiceParty } from "./types";

const now = new Date();
const today = businessDate(now);
const ctx: E.Ctx = { now, actorId: "m-owner", branchId: "br-main" };
const buyer: TaxInvoiceParty = { name: "บริษัท ผู้ซื้อ จำกัด", taxId: "1101700230708", address: "99 ถ.สุขุมวิท กรุงเทพฯ 10110", branchNo: "00000" };

/** A shop with one paid bill (2 × ฿60 = ฿120, VAT included) and, optionally, everything a tax invoice needs on file. */
function shopWithPaidBill(opts: { vat?: boolean; taxId?: string | null; address?: boolean; pay?: boolean } = {}): { s: DemoState; orderId: string } {
  let orderId = "";
  const s = produce(freshState(today), (d) => {
    d.tenant.vatRegistered = opts.vat ?? true;
    d.tenant.taxId = opts.taxId === null ? undefined : (opts.taxId ?? "1101700230708");
    d.tenant.legalName = "บริษัท สบายคาเฟ่ จำกัด";
    d.branches[0]!.address = opts.address === false ? undefined : "12 ซ.อารีย์ กรุงเทพฯ 10400";
    const mi = E.addMenuItem(d, ctx, { name: "อเมริกาโน่", emoji: "☕", price: 6000, route: "bar", categoryName: "กาแฟ" });
    E.openShift(d, ctx, 100000);
    const o = E.submitOrder(d, ctx, { id: "o1", channelId: "ch-dine", items: [{ id: "i1", menuItemId: mi.id, qty: 2, modifierOptionIds: [] }] });
    orderId = o.id;
    if (opts.pay !== false) E.payOrder(d, ctx, o.id, [{ methodId: "pm-cash", amount: o.totals.total, tendered: 20000 }]);
  });
  return { s, orderId };
}

const issue = (s: DemoState, orderId: string, b: TaxInvoiceParty = buyer, c: E.Ctx = ctx) => produce(s, (d) => void E.issueTaxInvoice(d, c, orderId, b));

describe("a full tax invoice in the demo (same rules as the database)", () => {
  it("issues one for a paid bill, with the seller and the amounts as they are today", () => {
    const { s, orderId } = shopWithPaidBill();
    const after = issue(s, orderId);
    const inv = after.taxInvoices[0]!;
    const order = after.orders.find((o) => o.id === orderId)!;
    expect(inv.invoiceNo).toMatch(/^HQ-TI-\d{4}-00001$/);
    expect(order.taxInvoiceNo).toBe(inv.invoiceNo);
    expect(inv).toMatchObject({ orderId, receiptNo: order.receiptNo, seller: { name: "บริษัท สบายคาเฟ่ จำกัด", taxId: "1101700230708", address: "12 ซ.อารีย์ กรุงเทพฯ 10400" }, buyer, total: order.totals.total, vatAmount: order.totals.vatAmount });
    expect(inv.amountBeforeVat).toBe(amountBeforeVat({ itemsTotal: order.totals.itemsTotal, discountTotal: order.totals.discountTotal, serviceCharge: order.totals.serviceCharge, vatAmount: order.totals.vatAmount, pricesIncludeVat: after.tenant.pricesIncludeVat }));
    expect(inv.lines).toEqual([{ name: "อเมริกาโน่", qty: 2, modifiers: [], unitPrice: 6000, amount: 12000 }]);
    expect(after.activity.at(0)?.type).toBe("order.tax_invoiced");
  });

  it("does not move when the shop later changes its name or address", () => {
    const { s, orderId } = shopWithPaidBill();
    const after = produce(issue(s, orderId), (d) => {
      d.tenant.legalName = "ชื่อใหม่ จำกัด";
      d.branches[0]!.address = "ที่อยู่ใหม่";
    });
    expect(after.taxInvoices[0]!.seller).toMatchObject({ name: "บริษัท สบายคาเฟ่ จำกัด", address: "12 ซ.อารีย์ กรุงเทพฯ 10400" });
  });

  it("numbers invoices one after another", () => {
    const { s, orderId } = shopWithPaidBill();
    let more = "";
    const two = produce(issue(s, orderId), (d) => {
      const mi = d.menuItems[0]!;
      const o = E.submitOrder(d, ctx, { id: "o2", channelId: "ch-dine", items: [{ id: "i2", menuItemId: mi.id, qty: 1, modifierOptionIds: [] }] });
      E.payOrder(d, ctx, o.id, [{ methodId: "pm-cash", amount: o.totals.total }]);
      more = o.id;
    });
    expect(issue(two, more).taxInvoices.map((i) => i.invoiceNo.slice(-5))).toEqual(["00001", "00002"]);
  });

  it("is one per bill, and says which", () => {
    const { s, orderId } = shopWithPaidBill();
    const once = issue(s, orderId);
    expect(() => issue(once, orderId, { ...buyer, name: "คนอื่น" })).toThrowError(expect.objectContaining({ code: "TAX_INVOICE_EXISTS", params: { invoice_no: once.taxInvoices[0]!.invoiceNo } }));
  });

  it.each([
    ["the shop is not VAT-registered", { vat: false }],
    ["the shop has no taxpayer number", { taxId: null }],
    ["the shop's taxpayer number cannot be right", { taxId: "1101700230705" }],
    ["the branch has no address", { address: false }],
  ])("is not available when %s", (_why, opts) => {
    const { s, orderId } = shopWithPaidBill(opts);
    expect(() => issue(s, orderId)).toThrowError(expect.objectContaining({ code: "TAX_INVOICE_NOT_AVAILABLE" }));
  });

  it("needs a paid bill that has not been refunded", () => {
    const open = shopWithPaidBill({ pay: false });
    expect(() => issue(open.s, open.orderId)).toThrowError(expect.objectContaining({ code: "TAX_INVOICE_ORDER_NOT_PAID" }));
    const paid = shopWithPaidBill();
    const refunded = produce(paid.s, (d) => E.refundOrder(d, ctx, paid.orderId, "ทดสอบ", false));
    expect(() => issue(refunded, paid.orderId)).toThrowError(expect.objectContaining({ code: "TAX_INVOICE_ORDER_NOT_PAID" }));
  });

  it("names every field of the buyer that cannot be right", () => {
    const { s, orderId } = shopWithPaidBill();
    try {
      issue(s, orderId, { name: " ", taxId: "1101700230705", address: "", branchNo: "12" });
      expect.unreachable();
    } catch (e) {
      expect((e as E.DomainError).code).toBe("VALIDATION");
      expect(Object.keys((e as E.DomainError).params.fields as object).sort()).toEqual(["address", "branchNo", "name", "taxId"]);
    }
  });

  it("is for whoever may take the money, and nobody else", () => {
    const { s, orderId } = shopWithPaidBill();
    // Someone whose role cannot take payment: the same person as the owner, but in a role without `pos.pay`.
    const role = s.roles.find((r) => !r.grantsAll && !r.permissions.includes("pos.pay"));
    expect(role).toBeTruthy();
    const withKitchen = produce(s, (d) => void d.members.push({ ...d.members[0]!, id: "m-no-pay", roleKey: role!.key }));
    expect(() => issue(withKitchen, orderId, buyer, { ...ctx, actorId: "m-no-pay" })).toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(issue(s, orderId).taxInvoices).toHaveLength(1);
  });
});
