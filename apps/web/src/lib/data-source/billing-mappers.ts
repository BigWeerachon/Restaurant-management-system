/** The API's bill for using Sabai, turned into what the screens use (money in satang, dates as the server sent them). */
import { toSatang } from "@sabai/domain";
import type { BillingInvoice, BillingState, PaymentInstructions, UsageMeter } from "../demo/types";

export interface PaymentInstructionsApi {
  method: "transfer";
  reference: string;
  amount: string;
  promptpayId: string | null;
  bankName: string | null;
  accountNo: string | null;
  accountName: string | null;
}

export interface InvoiceApi {
  id: string;
  invoiceNo: string;
  status: BillingInvoice["status"];
  kind: BillingInvoice["kind"];
  planCode: BillingInvoice["planCode"];
  billingCycle: BillingInvoice["billingCycle"];
  subtotal: string;
  vatAmount: string;
  total: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  payment: PaymentInstructionsApi | null;
}

export interface BillingApi {
  mode: BillingState["mode"];
  planCode: BillingState["planCode"];
  status: BillingState["status"];
  billingCycle: BillingState["billingCycle"];
  stage: BillingState["stage"];
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  graceDays: number;
  openInvoice: InvoiceApi | null;
  invoices: InvoiceApi[];
  usage?: UsageApi | null;
}

export interface UsageApi {
  periodStart: string;
  periodEnd: string;
  orders: number;
  fee: string;
  carriedIn: string;
  total: string;
  branches: { branchId: string; name: string; orders: number; fee: string; capped: boolean }[];
}

export const mapUsage = (u: UsageApi): UsageMeter => ({
  periodStart: u.periodStart,
  periodEnd: u.periodEnd,
  orders: u.orders,
  fee: toSatang(u.fee),
  carriedIn: toSatang(u.carriedIn),
  total: toSatang(u.total),
  branches: u.branches.map((b) => ({ branchId: b.branchId, name: b.name, orders: b.orders, fee: toSatang(b.fee), capped: b.capped })),
});

const mapPayment = (p: PaymentInstructionsApi): PaymentInstructions => ({
  reference: p.reference,
  amount: toSatang(p.amount),
  promptpayId: p.promptpayId,
  bankName: p.bankName,
  accountNo: p.accountNo,
  accountName: p.accountName,
});

export const mapInvoice = (i: InvoiceApi): BillingInvoice => ({
  id: i.id,
  invoiceNo: i.invoiceNo,
  status: i.status,
  kind: i.kind,
  planCode: i.planCode,
  billingCycle: i.billingCycle,
  subtotal: toSatang(i.subtotal),
  vatAmount: toSatang(i.vatAmount),
  total: toSatang(i.total),
  periodStart: i.periodStart,
  periodEnd: i.periodEnd,
  dueAt: i.dueAt,
  paidAt: i.paidAt,
  createdAt: i.createdAt,
  payment: i.payment ? mapPayment(i.payment) : null,
});

export const mapBilling = (b: BillingApi): BillingState => ({
  mode: b.mode,
  planCode: b.planCode,
  status: b.status,
  billingCycle: b.billingCycle,
  stage: { kind: b.stage.kind, daysLeft: b.stage.daysLeft, grow: b.stage.grow },
  trialEndsAt: b.trialEndsAt,
  currentPeriodEnd: b.currentPeriodEnd,
  cancelAtPeriodEnd: b.cancelAtPeriodEnd,
  pastDueSince: b.pastDueSince,
  graceDays: b.graceDays,
  openInvoice: b.openInvoice ? mapInvoice(b.openInvoice) : null,
  invoices: b.invoices.map(mapInvoice),
  usage: b.usage ? mapUsage(b.usage) : null,
});
