import { describe, expect, it } from "vitest";
import type { Branch, Channel, Member, Order, PaymentMethod, Tenant } from "./demo/types";
import { buildReceipt, buildSampleReceipt, money } from "./receipt";

const tenant = (over: Partial<Tenant> = {}): Tenant => ({
  name: "ครัวคุณแม่",
  businessType: "restaurant",
  vatRegistered: false,
  pricesIncludeVat: true,
  vatRate: 0.07,
  cashRounding: "none",
  plan: "pro",
  trialEndsAt: "",
  onboarding: { skipped: [], paymentsConfirmed: false },
  ...over,
});
const branch: Branch = { id: "b1", code: "HQ", name: "สาขาอารีย์", address: "12 ซ.อารีย์ กรุงเทพฯ", phone: "02-000-0000", dayCutoff: "05:00", serviceChargeRate: 0, tables: [{ id: "t1", name: "A3", seats: 4, zone: "ใน" }], taxBranchNo: "00000" };
const channel: Channel = { id: "c1", key: "dine_in", kind: "dine_in", name: "ทานที่ร้าน", color: "emerald", active: true, appliesServiceCharge: true, commissionRate: 0, settlementDays: 0, priceMarkup: 0 } as Channel;
const methods: PaymentMethod[] = [
  { id: "cash", kind: "cash", name: "เงินสด", active: true, feeRate: 0, requiresReference: false, settlementDays: 0 },
  { id: "qr", kind: "promptpay", name: "พร้อมเพย์", active: true, feeRate: 0, requiresReference: false, settlementDays: 0 },
];
const members: Member[] = [{ id: "m1", name: "น้องแพรว", roleKey: "cashier", pin: "", branchIds: "all", color: "emerald", active: true }];

const order = (over: Partial<Order> = {}): Order => ({
  id: "o1",
  branchId: "b1",
  channelId: "c1",
  tableId: "t1",
  orderNo: "012",
  receiptNo: "HQ-2609-00007",
  status: "paid",
  businessDate: "2026-09-29",
  openedAt: "2026-09-29T05:10:00.000Z",
  paidAt: "2026-09-29T05:40:00.000Z",
  openedBy: "m1",
  items: [
    { id: "i1", menuItemId: "m1", name: "ข้าวกะเพราหมูสับ", emoji: "", qty: 2, unitPrice: 7500, modifiers: [{ id: "x", name: "เผ็ดมาก", priceDelta: 0 }], status: "served" },
    { id: "i2", menuItemId: "m2", name: "ลาเต้เย็น", emoji: "", qty: 1, unitPrice: 6500, modifiers: [{ id: "y", name: "นมโอ๊ต", priceDelta: 1500 }], note: "หวานน้อย", status: "served" },
    { id: "i3", menuItemId: "m3", name: "ของที่ยกเลิก", emoji: "", qty: 1, unitPrice: 9900, modifiers: [], status: "voided" },
  ],
  payments: [{ id: "p1", methodId: "cash", kind: "payment", amount: 23000, tendered: 50000, change: 27000, fee: 0, at: "2026-09-29T05:40:00.000Z" }],
  totals: { itemsTotal: 23000, discountTotal: 0, serviceCharge: 0, vatAmount: 0, rounding: 0, total: 23000, commission: 0, commissionVat: 0, netSales: 23000 },
  commissionRate: 0,
  ...over,
});

const build = (o: Order, t: Tenant = tenant(), copy = false) => buildReceipt({ order: o, tenant: t, branch, channel, methods, members, copy });

describe("money on a receipt", () => {
  it("is baht with two decimals and thousands separators, no sign for a positive amount", () => {
    expect(money(0)).toBe("0.00");
    expect(money(5)).toBe("0.05");
    expect(money(12345)).toBe("123.45");
    expect(money(123456789)).toBe("1,234,567.89");
    expect(money(-2050)).toBe("-20.50");
  });
});

describe("a receipt", () => {
  it("lists what was bought — voided items left out, modifiers and notes under the item, line totals with the modifier price in", () => {
    const r = build(order());
    expect(r.lines).toEqual([
      { qty: 2, name: "ข้าวกะเพราหมูสับ", modifiers: ["เผ็ดมาก"], note: undefined, amount: "150.00" },
      { qty: 1, name: "ลาเต้เย็น", modifiers: ["นมโอ๊ต"], note: "หวานน้อย", amount: "80.00" },
    ]);
  });

  it("says who, where and when — in Thai time and the Buddhist year", () => {
    const r = build(order());
    expect(r.meta).toMatchObject({ receiptNo: "HQ-2609-00007", orderNo: "012", channel: "ทานที่ร้าน", table: "A3", cashier: "น้องแพรว", date: "29/09/2569", time: "12:40" });
    expect(r.seller).toMatchObject({ name: "ครัวคุณแม่", address: "12 ซ.อารีย์ กรุงเทพฯ", phone: "02-000-0000", branchLabel: "สาขาอารีย์" });
  });

  it("gives the change on a cash payment, and only then", () => {
    expect(build(order()).payments).toEqual([
      { label: "เงินสด", amount: "230.00" },
      { label: "รับมา", amount: "500.00" },
      { label: "เงินทอน", amount: "270.00" },
    ]);
    const qr = build(order({ payments: [{ id: "p", methodId: "qr", kind: "payment", amount: 23000, change: 0, fee: 0, reference: "TXN123", at: "2026-09-29T05:40:00.000Z" }] }));
    expect(qr.payments).toEqual([
      { label: "พร้อมเพย์", amount: "230.00" },
      { label: "อ้างอิง", amount: "TXN123" },
    ]);
  });

  it("shows discount, service charge and rounding when there are some, and the total last", () => {
    const r = build(
      order({
        discount: { type: "percent", value: 10, reason: "ลูกค้าประจำ" },
        totals: { itemsTotal: 23000, discountTotal: 2300, serviceCharge: 2070, vatAmount: 0, rounding: -20, total: 22750, commission: 0, commissionVat: 0, netSales: 22750 },
      }),
    );
    expect(r.summary.map((x) => [x.label, x.amount])).toEqual([
      ["รวมรายการ", "230.00"],
      ["ส่วนลด (ลูกค้าประจำ)", "-23.00"],
      ["ค่าบริการ", "20.70"],
      ["ปัดเศษ", "-0.20"],
      ["ยอดสุทธิ", "227.50"],
    ]);
    expect(r.summary.at(-1)?.strong).toBe(true);
  });

  it("for a shop not registered for VAT: a plain receipt, no VAT lines, never called a tax invoice", () => {
    const r = build(order(), tenant({ taxId: "1101700230708" }));
    expect(r.title).toBe("ใบเสร็จรับเงิน");
    expect(r.summary.some((x) => x.label.includes("ภาษี"))).toBe(false);
    expect(r.notes).toEqual([]);
  });

  describe("for a VAT-registered shop", () => {
    const vat = (over: Partial<Tenant> = {}) => tenant({ vatRegistered: true, taxId: "1101700230708", legalName: "บริษัท ครัวคุณแม่ จำกัด", ...over });
    const withVat = order({ totals: { itemsTotal: 23000, discountTotal: 0, serviceCharge: 0, vatAmount: 1505, rounding: 0, total: 23000, commission: 0, commissionVat: 0, netSales: 21495 } });

    it("is an abbreviated tax invoice: the seller's legal name, taxpayer number and branch, the VAT split, and the words 'prices include VAT'", () => {
      const r = build(withVat, vat());
      expect(r.title).toBe("ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ");
      expect(r.seller).toMatchObject({ legalName: "บริษัท ครัวคุณแม่ จำกัด", name: "ครัวคุณแม่", taxId: "1-1017-00230-70-8", branchLabel: "สำนักงานใหญ่" });
      expect(r.summary.map((x) => [x.label, x.amount])).toEqual([
        ["รวมรายการ", "230.00"],
        ["มูลค่าก่อนภาษี", "214.95"],
        ["ภาษีมูลค่าเพิ่ม 7%", "15.05"],
        ["ยอดสุทธิ", "230.00"],
      ]);
      expect(r.notes).toEqual(["ราคาสินค้ารวมภาษีมูลค่าเพิ่มแล้ว"]);
    });

    it("names a branch by its tax number, not its trade name", () => {
      const r = buildReceipt({ order: withVat, tenant: vat(), branch: { ...branch, taxBranchNo: "00012" }, channel, methods, members });
      expect(r.seller.branchLabel).toBe("สาขาที่ 00012");
    });

    it("when prices exclude VAT the VAT is added on top of the base", () => {
      const excl = order({ totals: { itemsTotal: 23000, discountTotal: 0, serviceCharge: 0, vatAmount: 1610, rounding: 0, total: 24610, commission: 0, commissionVat: 0, netSales: 23000 } });
      const r = build(excl, vat({ pricesIncludeVat: false }));
      expect(r.summary.map((x) => [x.label, x.amount])).toEqual([
        ["รวมรายการ", "230.00"],
        ["มูลค่าก่อนภาษี", "230.00"],
        ["ภาษีมูลค่าเพิ่ม 7%", "16.10"],
        ["ยอดสุทธิ", "246.10"],
      ]);
      expect(r.notes).toEqual([]);
    });

    it("is only a plain receipt while the taxpayer number is missing", () => {
      expect(build(withVat, vat({ taxId: undefined })).title).toBe("ใบเสร็จรับเงิน");
    });
  });

  it("a bill paid on the device and not yet sent has no number: a provisional slip that says so, never a tax invoice", () => {
    const r = build(order({ receiptNo: undefined }), tenant({ vatRegistered: true, taxId: "1101700230708" }));
    expect(r.title).toBe("ใบเสร็จชั่วคราว");
    expect(r.banner).toContain("ยังไม่ออกเลขที่ใบเสร็จ");
    expect(r.meta.receiptNo).toBeUndefined();
  });

  it("a reprint says it is a copy; a refunded bill says so, and shows the money given back", () => {
    expect(build(order(), tenant(), true).banner).toBe("สำเนา");
    const refunded = build(
      order({
        status: "refunded",
        payments: [
          { id: "p1", methodId: "cash", kind: "payment", amount: 23000, change: 0, fee: 0, at: "x" },
          { id: "p2", methodId: "cash", kind: "refund", amount: 23000, change: 0, fee: 0, at: "y" },
        ],
      }),
      tenant(),
      true,
    );
    expect(refunded.banner).toBe("คืนเงินแล้ว · สำเนา");
    expect(refunded.payments.at(-1)).toEqual({ label: "คืนเงิน (เงินสด)", amount: "-230.00" });
  });

  it("ends with the shop's own line, or a plain thank-you", () => {
    expect(build(order()).footer).toEqual(["ขอบคุณที่มาอุดหนุน"]);
    expect(build(order(), tenant({ receiptFooter: "ไวไฟ sabai1234" })).footer).toEqual(["ไวไฟ sabai1234"]);
  });

  it("a sample slip is marked as a test, has no number, and uses the shop's own details", () => {
    const r = buildSampleReceipt({ tenant: tenant({ receiptFooter: "ขอบคุณค่ะ" }), branch });
    expect(r.title).toBe("ตัวอย่างใบเสร็จ");
    expect(r.banner).toBe("ทดลองพิมพ์ — ไม่ใช่ใบเสร็จจริง");
    expect(r.meta.receiptNo).toBeUndefined();
    expect(r.seller.address).toBe("12 ซ.อารีย์ กรุงเทพฯ");
    expect(r.footer).toEqual(["ขอบคุณค่ะ"]);
    expect(r.summary.at(-1)).toEqual({ label: "ยอดสุทธิ", amount: "205.00", strong: true });
  });
});
