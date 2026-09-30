/** Full tax invoices for the API adapter (checklist 7.3). An invoice never changes once issued, so a copy that was read is kept. */
import { toSatang } from "@sabai/domain";
import { DomainError } from "../demo/engine";
import { useSabai } from "../demo/store";
import type { TaxInvoice, TaxInvoiceParty } from "../demo/types";
import { apiFetch } from "./http-client";
import type { DataSource } from "./types";

interface PartyApi {
  name: string;
  taxId: string;
  branchNo: string;
  address: string;
}

export interface TaxInvoiceApi {
  id: string;
  invoiceNo: string;
  orderId: string;
  branchId: string;
  receiptNo: string | null;
  issuedAt: string;
  issuedByName: string | null;
  seller: PartyApi;
  buyer: PartyApi;
  lines: { name: string; qty: number; unitPrice: string; modifiersTotal: string; amount: string; modifiers: string[] }[];
  itemsTotal: string;
  discountTotal: string;
  discountReason: string | null;
  serviceCharge: string;
  amountBeforeVat: string;
  vatRate: number;
  vatAmount: string;
  rounding: string;
  total: string;
  pricesIncludeVat: boolean;
}

export function mapTaxInvoice(r: TaxInvoiceApi): TaxInvoice {
  return {
    id: r.id,
    invoiceNo: r.invoiceNo,
    orderId: r.orderId,
    branchId: r.branchId,
    receiptNo: r.receiptNo ?? undefined,
    issuedAt: r.issuedAt,
    issuedByName: r.issuedByName ?? undefined,
    seller: r.seller,
    buyer: r.buyer,
    lines: r.lines.map((l) => ({ name: l.name, qty: l.qty, modifiers: l.modifiers, unitPrice: toSatang(l.unitPrice) + toSatang(l.modifiersTotal), amount: toSatang(l.amount) })),
    itemsTotal: toSatang(r.itemsTotal),
    discountTotal: toSatang(r.discountTotal),
    discountReason: r.discountReason ?? undefined,
    serviceCharge: toSatang(r.serviceCharge),
    amountBeforeVat: toSatang(r.amountBeforeVat),
    vatRate: r.vatRate,
    vatAmount: toSatang(r.vatAmount),
    rounding: toSatang(r.rounding),
    total: toSatang(r.total),
    pricesIncludeVat: r.pricesIncludeVat,
  };
}

/** Keeps the invoice, and the bill's number for it, where the screens read them. */
function remember(invoice: TaxInvoice) {
  useSabai.getState().patch((d) => {
    d.taxInvoices = [...d.taxInvoices.filter((i) => i.orderId !== invoice.orderId), invoice];
    const order = d.orders.find((o) => o.id === invoice.orderId);
    if (order) order.taxInvoiceNo = invoice.invoiceNo;
  });
}

export const taxInvoiceCommands = {
  async issueTaxInvoice(orderId: string, buyer: TaxInvoiceParty) {
    const r = await apiFetch<TaxInvoiceApi>(`/v1/orders/${orderId}/tax-invoice`, {
      method: "POST",
      body: { buyerName: buyer.name, buyerTaxId: buyer.taxId, buyerAddress: buyer.address, buyerBranchNo: buyer.branchNo },
    });
    const invoice = mapTaxInvoice(r);
    remember(invoice);
    return invoice;
  },

  async getTaxInvoice(orderId: string) {
    const kept = useSabai.getState().db.taxInvoices.find((i) => i.orderId === orderId);
    if (kept) return kept;
    try {
      const invoice = mapTaxInvoice(await apiFetch<TaxInvoiceApi>(`/v1/orders/${orderId}/tax-invoice`));
      remember(invoice);
      return invoice;
    } catch (e) {
      // "Not found" is the answer for a bill that never had one.
      if (e instanceof DomainError && e.code === "NOT_FOUND") return null;
      throw e;
    }
  },
} satisfies Partial<DataSource>;
