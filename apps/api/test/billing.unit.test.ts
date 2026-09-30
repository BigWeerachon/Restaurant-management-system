import { describe, expect, it } from "vitest";
import { createBillingProvider } from "../src/billing/provider";
import { signWebhook, verifyWebhook, WEBHOOK_TOLERANCE_SECONDS } from "../src/billing/webhook";
import { loadConfig } from "../src/config";
import { ApiFailure } from "../src/errors";

const secret = "billing-webhook-secret-that-is-32-chars-long!!";
const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: { invoiceNo: "INV-2610-00001", amount: "1490.00" } });
const at = new Date("2026-10-15T05:00:00Z");
const refused = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiFailure);
    expect((e as ApiFailure).code).toBe("AUTH_REQUIRED");
    return;
  }
  throw new Error("expected the signature to be refused");
};

describe("webhook signatures", () => {
  it("accepts a fresh signature of exactly this body", () => {
    expect(() => verifyWebhook(secret, body, signWebhook(secret, body, at), at)).not.toThrow();
    expect(() => verifyWebhook(secret, body, signWebhook(secret, body, at), new Date(at.getTime() + (WEBHOOK_TOLERANCE_SECONDS - 1) * 1000))).not.toThrow();
  });

  it("refuses a changed body, another secret, a missing or mangled header, and a replay later", () => {
    const header = signWebhook(secret, body, at);
    refused(() => verifyWebhook(secret, body.replace("1490.00", "1.00"), header, at));
    refused(() => verifyWebhook("some-other-secret-that-is-also-32-chars!!", body, header, at));
    refused(() => verifyWebhook(secret, body, undefined, at));
    refused(() => verifyWebhook(secret, body, "", at));
    refused(() => verifyWebhook(secret, body, "t=abc,v1=zz", at));
    refused(() => verifyWebhook(secret, body, header.replace(/v1=.{4}/, "v1=0000"), at));
    refused(() => verifyWebhook(secret, body, header, new Date(at.getTime() + (WEBHOOK_TOLERANCE_SECONDS + 1) * 1000)));
    refused(() => verifyWebhook(secret, body, header, new Date(at.getTime() - (WEBHOOK_TOLERANCE_SECONDS + 1) * 1000)));
  });

  it("never verifies against an empty secret", () => {
    refused(() => verifyWebhook("", body, signWebhook("", body, at), at));
  });
});

describe("billing configuration", () => {
  it("is off by default, so a plan change applies at once as it always has", () => {
    const c = loadConfig({});
    expect(c.billing.provider).toBe("none");
    expect(createBillingProvider(c.billing)).toBeNull();
  });

  it("turns on invoices only with a secret and somewhere to pay", () => {
    const pay = { BILLING_PROVIDER: "manual", BILLING_WEBHOOK_SECRET: secret, BILLING_PROMPTPAY_ID: "0105536001239" };
    const c = loadConfig(pay);
    expect(c.billing.provider).toBe("manual");
    expect(createBillingProvider(c.billing)!.paymentInstructions({ invoiceNo: "INV-2610-00001", total: "1490.00" })).toMatchObject({
      reference: "INV-2610-00001",
      amount: "1490.00",
      promptpayId: "0105536001239",
    });
    expect(() => loadConfig({ ...pay, BILLING_WEBHOOK_SECRET: "short" })).toThrow(/BILLING_WEBHOOK_SECRET/);
    expect(() => loadConfig({ BILLING_PROVIDER: "manual", BILLING_WEBHOOK_SECRET: secret })).toThrow(/where to pay|PROMPTPAY|BANK/);
    // Card providers arrive with their keys (checklist 8.2): asking for one now is a mistake worth failing loudly on.
    expect(() => loadConfig({ BILLING_PROVIDER: "stripe" })).toThrow(/BILLING_PROVIDER/);
  });

  it("gives the job secret only when it is long enough to be one", () => {
    expect(loadConfig({ BILLING_JOB_SECRET: "short" }).billing.jobSecret).toBeNull();
    expect(loadConfig({ BILLING_JOB_SECRET: secret }).billing.jobSecret).toBe(secret);
    expect(loadConfig({ NODE_ENV: "test" }).billing.jobIntervalMinutes).toBe(0);
    expect(loadConfig({}).billing.jobIntervalMinutes).toBe(60);
  });
});
