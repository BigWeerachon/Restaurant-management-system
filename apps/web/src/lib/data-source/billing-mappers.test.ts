import { describe, expect, it } from "vitest";
import { billing as selectBilling } from "../demo/selectors";
import { useSabai } from "../demo/store";
import { mapBilling, mapInvoice, type BillingApi, type InvoiceApi } from "./billing-mappers";
import { slicesForEvent } from "./realtime";

const invoice: InvoiceApi = {
  id: "inv-1",
  invoiceNo: "INV-2610-00001",
  status: "paid",
  kind: "renewal",
  planCode: "pro",
  billingCycle: "monthly",
  subtotal: "1392.52",
  vatAmount: "97.48",
  total: "1490.00",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  dueAt: "2026-10-01T00:00:00.000Z",
  paidAt: "2026-10-02T03:00:00.000Z",
  createdAt: "2026-09-24T00:00:00.000Z",
  payment: null,
};

describe("the bill for using Sabai, as the screens see it", () => {
  it("turns the API's decimal strings into satang without a float in between", () => {
    const i = mapInvoice(invoice);
    expect(i).toMatchObject({ subtotal: 139_252, vatAmount: 9_748, total: 149_000 });
    expect(i.subtotal + i.vatAmount).toBe(i.total);
    // The amounts a float would get wrong.
    expect(mapInvoice({ ...invoice, total: "0.29", subtotal: "0.27", vatAmount: "0.02" }).total).toBe(29);
    expect(mapInvoice({ ...invoice, total: "1.15" }).total).toBe(115);
  });

  it("keeps how to pay, only on the invoice that has it", () => {
    const pay = { method: "transfer" as const, reference: "INV-2610-00001", amount: "1490.00", promptpayId: "0105536001239", bankName: "ธ.ตัวอย่าง", accountNo: "123", accountName: "บริษัท" };
    expect(mapInvoice({ ...invoice, status: "open", payment: pay }).payment).toEqual({ reference: "INV-2610-00001", amount: 149_000, promptpayId: "0105536001239", bankName: "ธ.ตัวอย่าง", accountNo: "123", accountName: "บริษัท" });
    expect(mapInvoice(invoice).payment).toBeNull();
  });

  it("maps the whole bill", () => {
    const api: BillingApi = {
      mode: "invoice",
      planCode: "pro",
      status: "past_due",
      billingCycle: "monthly",
      stage: { kind: "past_due", daysLeft: 5, grow: true },
      trialEndsAt: null,
      currentPeriodEnd: "2026-11-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      pastDueSince: "2026-10-01T00:00:00.000Z",
      graceDays: 14,
      openInvoice: { ...invoice, status: "open" },
      invoices: [{ ...invoice, status: "open" }, invoice],
    };
    const b = mapBilling(api);
    expect(b.stage).toEqual({ kind: "past_due", daysLeft: 5, grow: true });
    expect(b.openInvoice!.total).toBe(149_000);
    expect(b.invoices.map((i) => i.status)).toEqual(["open", "paid"]);
  });

  it("makes a subscription event read the bill again, alongside the settings", () => {
    expect(slicesForEvent("subscription.paid")).toEqual(expect.arrayContaining(["billing", "settings"]));
    expect(slicesForEvent("subscription.restricted")).toContain("billing");
    expect(slicesForEvent("order.paid")).not.toContain("billing");
  });
});

describe("the demo has nothing to pay", () => {
  it("is 'off', on a plan, with the trial while there is one — and never restricted", () => {
    useSabai.getState().reset("demo");
    const state = useSabai.getState().db;
    const soon = new Date("2026-10-01T00:00:00Z");
    const inTrial = selectBilling({ ...state, tenant: { ...state.tenant, plan: "pro", trialEndsAt: "2026-10-09T05:00:00.000Z" } }, soon);
    expect(inTrial).toMatchObject({ mode: "off", planCode: "pro", status: "trialing", openInvoice: null, invoices: [] });
    expect(inTrial.stage.kind).toBe("trial");
    expect(inTrial.stage.daysLeft).toBe(9);
    const after = selectBilling({ ...state, tenant: { ...state.tenant, plan: "pro", trialEndsAt: "2026-09-01T00:00:00.000Z" } }, soon);
    expect(after.status).toBe("active");
    expect(after.stage.grow).toBe(true);
    // What the server says wins when there is one.
    const fromServer = mapBilling({ mode: "invoice", planCode: "pro", status: "restricted", billingCycle: "yearly", stage: { kind: "restricted", daysLeft: null, grow: false }, trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, pastDueSince: null, graceDays: 14, openInvoice: null, invoices: [] });
    expect(selectBilling({ ...state, billing: fromServer }, soon).stage.kind).toBe("restricted");
  });
});
