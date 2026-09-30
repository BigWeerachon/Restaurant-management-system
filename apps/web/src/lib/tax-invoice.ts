/**
 * The full tax invoice (ใบกำกับภาษีเต็มรูป, checklist 7.3) as data: what is printed on the A4 page, worked out once, so
 * the screen and the paper cannot disagree. Everything comes from the issued invoice — never from the live bill or the
 * shop's current settings — because a document that has been handed out must read the same forever.
 */
import { bahtText, formatThaiTaxId, taxBranchLabel } from "@sabai/domain";
import type { Branch, Order, Tenant, TaxInvoice } from "./demo/types";
import { dateOf, money, timeOf, type ReceiptRow } from "./receipt";

export interface TaxInvoiceParty {
  name: string;
  address: string;
  /** "1-1017-00230-70-8". */
  taxId: string;
  /** "สำนักงานใหญ่" / "สาขาที่ 00003". */
  branchLabel: string;
}

export interface TaxInvoiceDoc {
  title: string;
  invoiceNo: string;
  /** The abbreviated slip it accompanies, when there is one. */
  receiptNo?: string;
  date: string;
  time: string;
  seller: TaxInvoiceParty;
  buyer: TaxInvoiceParty;
  lines: { no: number; name: string; modifiers: string[]; qty: string; unitPrice: string; amount: string }[];
  summary: ReceiptRow[];
  /** The total in Thai words. */
  words: string;
  notes: string[];
  issuedBy?: string;
  /** One page each, in this order. */
  copies: string[];
}

const party = (p: TaxInvoice["seller"]): TaxInvoiceParty => ({ name: p.name, address: p.address, taxId: formatThaiTaxId(p.taxId), branchLabel: taxBranchLabel(p.branchNo) });

export function buildTaxInvoiceDoc(inv: TaxInvoice): TaxInvoiceDoc {
  const vatPct = `${Math.round(inv.vatRate * 1000) / 10}%`;
  const summary: ReceiptRow[] = [{ label: "รวมรายการ", amount: money(inv.itemsTotal) }];
  if (inv.discountTotal > 0) summary.push({ label: inv.discountReason ? `ส่วนลด (${inv.discountReason})` : "ส่วนลด", amount: money(-inv.discountTotal) });
  if (inv.serviceCharge > 0) summary.push({ label: "ค่าบริการ", amount: money(inv.serviceCharge) });
  summary.push({ label: "มูลค่าก่อนภาษี", amount: money(inv.amountBeforeVat) });
  summary.push({ label: `ภาษีมูลค่าเพิ่ม ${vatPct}`, amount: money(inv.vatAmount) });
  if (inv.rounding !== 0) summary.push({ label: "ปัดเศษ", amount: money(inv.rounding) });
  summary.push({ label: "จำนวนเงินรวมทั้งสิ้น", amount: money(inv.total), strong: true });

  return {
    title: "ใบกำกับภาษี",
    invoiceNo: inv.invoiceNo,
    receiptNo: inv.receiptNo,
    date: dateOf(inv.issuedAt),
    time: timeOf(inv.issuedAt),
    seller: party(inv.seller),
    buyer: party(inv.buyer),
    lines: inv.lines.map((l, i) => ({ no: i + 1, name: l.name, modifiers: l.modifiers, qty: String(l.qty), unitPrice: money(l.unitPrice), amount: money(l.amount) })),
    summary,
    words: bahtText(inv.total),
    notes: inv.pricesIncludeVat ? ["ราคาสินค้ารวมภาษีมูลค่าเพิ่มแล้ว"] : [],
    issuedBy: inv.issuedByName,
    copies: ["ต้นฉบับ (สำหรับผู้ซื้อ)", "สำเนา (สำหรับผู้ขาย)"],
  };
}

export type TaxInvoiceBlocker = "not_vat" | "no_tax_id" | "no_address";

/** Why this shop cannot issue a full tax invoice yet, in words to act on; `null` when it can. Mirrors `app.issue_tax_invoice`. */
export function taxInvoiceBlocker(tenant: Pick<Tenant, "vatRegistered" | "taxId">, branch: Pick<Branch, "address"> | undefined, isValid: (taxId: string) => boolean): { code: TaxInvoiceBlocker; text: string } | null {
  if (!tenant.vatRegistered) return { code: "not_vat", text: "ร้านยังไม่ได้ตั้งเป็นผู้จดทะเบียนภาษีมูลค่าเพิ่ม (ตั้งค่า → ข้อมูลร้าน)" };
  if (!tenant.taxId || !isValid(tenant.taxId)) return { code: "no_tax_id", text: "ยังไม่ได้ใส่เลขประจำตัวผู้เสียภาษีของร้าน (ตั้งค่า → ใบเสร็จและเครื่องพิมพ์)" };
  if (!branch?.address?.trim()) return { code: "no_address", text: "สาขานี้ยังไม่มีที่อยู่ (ตั้งค่า → สาขา)" };
  return null;
}

/** A bill a tax invoice can be asked for: paid, has its receipt number, not refunded. */
export const canAskTaxInvoice = (order: Pick<Order, "status" | "receiptNo">) => order.status === "paid" && !!order.receiptNo;
