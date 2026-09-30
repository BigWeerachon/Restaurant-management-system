/**
 * What a receipt says, as data (checklist 7.1). One model feeds every way of putting it on paper — the browser's
 * print dialog (`components/pos/receipt-view.tsx`) and, later, a thermal printer's own commands (ESC/POS) — so the
 * two can never disagree about a total.
 */
import { formatThaiTaxId, lineTotal, taxBranchLabel, type Satang } from "@sabai/domain";
import type { Branch, Channel, Member, Order, PaymentMethod, Tenant } from "./demo/types";

export interface ReceiptLine {
  qty: number;
  name: string;
  /** Modifier names, one per line under the item ("นมโอ๊ต", "หวานน้อย"). */
  modifiers: string[];
  note?: string;
  /** Line total, formatted. */
  amount: string;
}

export interface ReceiptRow {
  label: string;
  amount: string;
  strong?: boolean;
}

export interface ReceiptData {
  /** The document's own name: what it legally is, or that it is only a provisional slip. */
  title: string;
  /** Extra line under the title: "สำเนา" on a reprint, "ยังไม่ออกเลขที่…" on a provisional slip, "คืนเงินแล้ว". */
  banner?: string;
  seller: { name: string; legalName?: string; address?: string; phone?: string; taxId?: string; branchLabel?: string };
  meta: { receiptNo?: string; orderNo: string; date: string; time: string; channel: string; table?: string; cashier?: string; guests?: number };
  lines: ReceiptLine[];
  summary: ReceiptRow[];
  payments: ReceiptRow[];
  /** "ราคาสินค้ารวมภาษีมูลค่าเพิ่มแล้ว" and the like. */
  notes: string[];
  footer: string[];
}

const BANGKOK = "Asia/Bangkok";

/** 12345 satang → "123.45" (no currency sign: a receipt's columns are all baht). */
export function money(satang: Satang): string {
  const abs = Math.abs(satang);
  const text = (abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return satang < 0 ? `-${text}` : text;
}

export const dateOf = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: BANGKOK });
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: BANGKOK });

export interface ReceiptInput {
  order: Order;
  tenant: Tenant;
  branch: Branch;
  channel?: Channel;
  methods: PaymentMethod[];
  members: Member[];
  /** A second printing of a receipt already given out. */
  copy?: boolean;
}

export function buildReceipt({ order, tenant, branch, channel, methods, members, copy }: ReceiptInput): ReceiptData {
  const { totals } = order;
  const paid = order.status === "paid" || order.status === "refunded";
  // Only a VAT-registered shop with its taxpayer number on file may call a receipt a tax invoice, and only once it has a number.
  const taxInvoice = paid && tenant.vatRegistered && !!tenant.taxId && !!order.receiptNo;
  const provisional = paid && !order.receiptNo;

  const title = taxInvoice ? "ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ" : provisional ? "ใบเสร็จชั่วคราว" : "ใบเสร็จรับเงิน";
  const banners = [
    order.status === "refunded" ? "คืนเงินแล้ว" : undefined,
    order.status === "voided" ? "บิลนี้ยกเลิกแล้ว" : undefined,
    provisional ? "ยังไม่ออกเลขที่ใบเสร็จ ระบบจะออกให้เมื่อบันทึกเข้าระบบ" : undefined,
    copy ? "สำเนา" : undefined,
  ].filter(Boolean) as string[];

  const lines: ReceiptLine[] = order.items
    .filter((i) => i.status !== "voided")
    .map((i) => ({
      qty: i.qty,
      name: i.name,
      modifiers: i.modifiers.map((m) => m.name),
      note: i.note,
      amount: money(lineTotal({ qty: i.qty, unitPrice: i.unitPrice, modifiersTotal: i.modifiers.reduce((s, m) => s + m.priceDelta, 0) })),
    }));

  const vatPct = `${Math.round(tenant.vatRate * 1000) / 10}%`;
  const summary: ReceiptRow[] = [{ label: "รวมรายการ", amount: money(totals.itemsTotal) }];
  if (totals.discountTotal > 0) summary.push({ label: order.discount?.reason ? `ส่วนลด (${order.discount.reason})` : "ส่วนลด", amount: money(-totals.discountTotal) });
  if (totals.serviceCharge > 0) summary.push({ label: "ค่าบริการ", amount: money(totals.serviceCharge) });
  const notes: string[] = [];
  if (tenant.vatRegistered) {
    const beforeVat = totals.itemsTotal - totals.discountTotal + totals.serviceCharge - (tenant.pricesIncludeVat ? totals.vatAmount : 0);
    summary.push({ label: "มูลค่าก่อนภาษี", amount: money(beforeVat) });
    summary.push({ label: `ภาษีมูลค่าเพิ่ม ${vatPct}`, amount: money(totals.vatAmount) });
    if (tenant.pricesIncludeVat) notes.push("ราคาสินค้ารวมภาษีมูลค่าเพิ่มแล้ว");
  }
  if (order.taxInvoiceNo) notes.push(`ออกใบกำกับภาษีเต็มรูปแล้ว เลขที่ ${order.taxInvoiceNo}`);
  if (totals.rounding !== 0) summary.push({ label: "ปัดเศษ", amount: money(totals.rounding) });
  summary.push({ label: "ยอดสุทธิ", amount: money(totals.total), strong: true });

  const payments: ReceiptRow[] = [];
  for (const p of order.payments) {
    const name = methods.find((m) => m.id === p.methodId)?.name ?? "ชำระเงิน";
    if (p.kind === "refund") {
      payments.push({ label: `คืนเงิน (${name})`, amount: money(-p.amount) });
      continue;
    }
    payments.push({ label: name, amount: money(p.amount) });
    if (p.tendered !== undefined && p.tendered > p.amount) {
      payments.push({ label: "รับมา", amount: money(p.tendered) });
      payments.push({ label: "เงินทอน", amount: money(p.change) });
    }
    if (p.reference) payments.push({ label: "อ้างอิง", amount: p.reference });
  }

  const at = order.paidAt ?? order.openedAt;
  const table = order.tableId ? branch.tables.find((t) => t.id === order.tableId)?.name : undefined;
  return {
    title,
    banner: banners.length ? banners.join(" · ") : undefined,
    seller: {
      name: tenant.name,
      legalName: tenant.legalName && tenant.legalName !== tenant.name ? tenant.legalName : undefined,
      address: branch.address,
      phone: branch.phone,
      taxId: tenant.taxId ? formatThaiTaxId(tenant.taxId) : undefined,
      branchLabel: taxInvoice ? taxBranchLabel(branch.taxBranchNo) : branch.name,
    },
    meta: {
      receiptNo: order.receiptNo,
      orderNo: order.orderNo,
      date: dateOf(at),
      time: timeOf(at),
      channel: channel?.name ?? "",
      table,
      cashier: members.find((m) => m.id === order.openedBy)?.name,
      guests: order.guestCount || undefined,
    },
    lines,
    summary,
    payments,
    notes,
    footer: [tenant.receiptFooter ?? "ขอบคุณที่มาอุดหนุน"].filter(Boolean) as string[],
  };
}

/** A made-up bill, to see how a printer and a roll turn out before a customer is waiting. Clearly marked, never numbered. */
export function buildSampleReceipt(input: Pick<ReceiptInput, "tenant" | "branch">): ReceiptData {
  const now = new Date().toISOString();
  const order: Order = {
    id: "sample",
    branchId: input.branch.id,
    channelId: "sample",
    orderNo: "000",
    status: "paid",
    businessDate: now.slice(0, 10),
    openedAt: now,
    paidAt: now,
    items: [
      { id: "1", menuItemId: "m1", name: "ข้าวกะเพราหมูสับ ไข่ดาว", emoji: "", qty: 2, unitPrice: 7500, modifiers: [{ id: "x", name: "เผ็ดมาก", priceDelta: 0 }], status: "served" },
      { id: "2", menuItemId: "m2", name: "ชาไทยเย็น", emoji: "", qty: 1, unitPrice: 5500, modifiers: [], note: "หวานน้อย", status: "served" },
    ],
    payments: [{ id: "p", methodId: "cash", kind: "payment", amount: 20500, tendered: 30000, change: 9500, fee: 0, at: now }],
    totals: { itemsTotal: 20500, discountTotal: 0, serviceCharge: 0, vatAmount: input.tenant.vatRegistered ? 1341 : 0, rounding: 0, total: 20500, commission: 0, commissionVat: 0, netSales: 20500 },
    commissionRate: 0,
  };
  const data = buildReceipt({ order, tenant: input.tenant, branch: input.branch, methods: [{ id: "cash", kind: "cash", name: "เงินสด", active: true, feeRate: 0, requiresReference: false, settlementDays: 0 }], members: [] });
  return { ...data, title: "ตัวอย่างใบเสร็จ", banner: "ทดลองพิมพ์ — ไม่ใช่ใบเสร็จจริง", meta: { ...data.meta, receiptNo: undefined, cashier: "ทดลอง" } };
}
