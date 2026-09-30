import type { BillingConfig } from "../config";

/** What the shop needs in order to pay one invoice. */
export interface PaymentInstructions {
  method: "transfer";
  /** Quote this when paying: it is how the payment finds its invoice. */
  reference: string;
  amount: string;
  promptpayId: string | null;
  bankName: string | null;
  accountNo: string | null;
  accountName: string | null;
}

export interface BillableInvoice {
  invoiceNo: string;
  total: string;
}

/**
 * A way of being paid. The rest of the API only knows this shape, so a card provider (Omise, Stripe) is one more
 * implementation: it answers with a checkout link instead of transfer details, and turns its own webhook payloads into
 * the events in `BillingWebhookBody`. Nothing else changes (checklist 8.2).
 */
export interface BillingProvider {
  readonly name: "manual";
  paymentInstructions(invoice: BillableInvoice): PaymentInstructions;
}

/** Bank transfer / PromptPay to the company's own account, confirmed by a person through the signed webhook. */
function manualProvider(payTo: BillingConfig["payTo"]): BillingProvider {
  return {
    name: "manual",
    paymentInstructions: (invoice) => ({
      method: "transfer",
      reference: invoice.invoiceNo,
      amount: invoice.total,
      promptpayId: payTo.promptpayId,
      bankName: payTo.bankName,
      accountNo: payTo.accountNo,
      accountName: payTo.accountName,
    }),
  };
}

/** `null` while online billing is off. */
export function createBillingProvider(config: BillingConfig): BillingProvider | null {
  return config.provider === "manual" ? manualProvider(config.payTo) : null;
}
