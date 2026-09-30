import { describe, expect, it } from "vitest";
import { isValidThaiTaxId } from "@sabai/domain";
import type { TaxInvoice } from "./demo/types";
import { buildTaxInvoiceDoc, canAskTaxInvoice, taxInvoiceBlocker } from "./tax-invoice";

const invoice: TaxInvoice = {
  id: "ti-1",
  invoiceNo: "HQ-TI-2609-00001",
  orderId: "o1",
  branchId: "b1",
  receiptNo: "HQ-2609-00001",
  issuedAt: "2026-09-29T05:30:00.000Z",
  issuedByName: "น้องแคช",
  seller: { name: "บริษัท สบายคาเฟ่ จำกัด", taxId: "1101700230708", branchNo: "00000", address: "12 ซ.อารีย์ กรุงเทพฯ 10400" },
  buyer: { name: "บริษัท ผู้ซื้อ จำกัด", taxId: "0105536001239", branchNo: "00003", address: "99 ถ.สุขุมวิท กรุงเทพฯ 10110" },
  lines: [
    { name: "ลาเต้เย็น", qty: 1, modifiers: [], unitPrice: 6500, amount: 6500 },
    { name: "ลาเต้เย็น", qty: 1, modifiers: ["นมโอ๊ต"], unitPrice: 8000, amount: 8000 },
  ],
  itemsTotal: 14500,
  discountTotal: 0,
  serviceCharge: 0,
  amountBeforeVat: 13551,
  vatRate: 0.07,
  vatAmount: 949,
  rounding: 0,
  total: 14500,
  pricesIncludeVat: true,
};

describe("the full tax invoice as printed", () => {
  it("says who sold, who bought, what, and how much — in the order a tax invoice reads", () => {
    const doc = buildTaxInvoiceDoc(invoice);
    expect(doc.title).toBe("ใบกำกับภาษี");
    expect(doc.invoiceNo).toBe("HQ-TI-2609-00001");
    expect(doc.receiptNo).toBe("HQ-2609-00001");
    expect(doc.date).toContain("2569");
    expect(doc.seller).toEqual({ name: "บริษัท สบายคาเฟ่ จำกัด", address: "12 ซ.อารีย์ กรุงเทพฯ 10400", taxId: "1-1017-00230-70-8", branchLabel: "สำนักงานใหญ่" });
    expect(doc.buyer).toMatchObject({ name: "บริษัท ผู้ซื้อ จำกัด", taxId: "0-1055-36001-23-9", branchLabel: "สาขาที่ 00003" });
    expect(doc.lines).toEqual([
      { no: 1, name: "ลาเต้เย็น", modifiers: [], qty: "1", unitPrice: "65.00", amount: "65.00" },
      { no: 2, name: "ลาเต้เย็น", modifiers: ["นมโอ๊ต"], qty: "1", unitPrice: "80.00", amount: "80.00" },
    ]);
    expect(doc.summary).toEqual([
      { label: "รวมรายการ", amount: "145.00" },
      { label: "มูลค่าก่อนภาษี", amount: "135.51" },
      { label: "ภาษีมูลค่าเพิ่ม 7%", amount: "9.49" },
      { label: "จำนวนเงินรวมทั้งสิ้น", amount: "145.00", strong: true },
    ]);
    expect(doc.words).toBe("หนึ่งร้อยสี่สิบห้าบาทถ้วน");
    expect(doc.notes).toEqual(["ราคาสินค้ารวมภาษีมูลค่าเพิ่มแล้ว"]);
    expect(doc.copies).toEqual(["ต้นฉบับ (สำหรับผู้ซื้อ)", "สำเนา (สำหรับผู้ขาย)"]);
  });

  it("shows discount, service charge and rounding when the bill had them, and no VAT-included note when VAT is on top", () => {
    const doc = buildTaxInvoiceDoc({ ...invoice, discountTotal: 1000, discountReason: "สมาชิก", serviceCharge: 1300, rounding: -50, total: 14750, pricesIncludeVat: false });
    expect(doc.summary.map((r) => r.label)).toEqual(["รวมรายการ", "ส่วนลด (สมาชิก)", "ค่าบริการ", "มูลค่าก่อนภาษี", "ภาษีมูลค่าเพิ่ม 7%", "ปัดเศษ", "จำนวนเงินรวมทั้งสิ้น"]);
    expect(doc.summary.find((r) => r.label.startsWith("ส่วนลด"))!.amount).toBe("-10.00");
    expect(doc.summary.find((r) => r.label === "ปัดเศษ")!.amount).toBe("-0.50");
    expect(doc.notes).toEqual([]);
  });

  it("reads the same whatever the shop changes later: it is built from the invoice alone", () => {
    expect(buildTaxInvoiceDoc(invoice)).toEqual(buildTaxInvoiceDoc(structuredClone(invoice)));
  });
});

describe("who can ask for one", () => {
  const address = { address: "12 ซ.อารีย์" };
  it("needs a VAT-registered shop with a good taxpayer number and a branch address, and says which is missing first", () => {
    expect(taxInvoiceBlocker({ vatRegistered: true, taxId: "1101700230708" }, address, isValidThaiTaxId)).toBeNull();
    expect(taxInvoiceBlocker({ vatRegistered: false, taxId: "1101700230708" }, address, isValidThaiTaxId)?.code).toBe("not_vat");
    expect(taxInvoiceBlocker({ vatRegistered: true, taxId: undefined }, address, isValidThaiTaxId)?.code).toBe("no_tax_id");
    expect(taxInvoiceBlocker({ vatRegistered: true, taxId: "1101700230705" }, address, isValidThaiTaxId)?.code).toBe("no_tax_id");
    expect(taxInvoiceBlocker({ vatRegistered: true, taxId: "1101700230708" }, { address: "  " }, isValidThaiTaxId)?.code).toBe("no_address");
    expect(taxInvoiceBlocker({ vatRegistered: true, taxId: "1101700230708" }, undefined, isValidThaiTaxId)?.code).toBe("no_address");
  });

  it("is asked for on a paid bill that has its number, not on open, refunded or still-unnumbered ones", () => {
    expect(canAskTaxInvoice({ status: "paid", receiptNo: "HQ-2609-00001" })).toBe(true);
    expect(canAskTaxInvoice({ status: "paid", receiptNo: undefined })).toBe(false);
    expect(canAskTaxInvoice({ status: "open", receiptNo: undefined })).toBe(false);
    expect(canAskTaxInvoice({ status: "refunded", receiptNo: "HQ-2609-00001" })).toBe(false);
  });
});
