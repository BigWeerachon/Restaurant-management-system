import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSabai } from "../demo/store";
import { clearApiSession, setApiSession } from "./http-client";
import { httpDataSource as ds } from "./http-data-source";
import type { ShopApiResponse } from "./mappers";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeApi(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { key: string; body: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: any) => {
      const u = new URL(String(url));
      const key = `${init?.method ?? "GET"} ${u.pathname}`;
      calls.push({ key, body: init?.body ? JSON.parse(init.body) : undefined });
      const r = routes[key];
      return r ? json(r.status ?? 200, r.body) : json(404, { error: { code: "NOT_FOUND" } });
    }),
  );
  return calls;
}

function shop(over: { name?: string; branches?: ShopApiResponse["branches"]; channels?: ShopApiResponse["channels"]; paymentMethods?: ShopApiResponse["paymentMethods"] } = {}): ShopApiResponse {
  const { db } = useSabai.getState();
  return {
    tenant: { name: over.name ?? "ร้านทดสอบ", businessType: "cafe", vatRegistered: false, pricesIncludeVat: true, vatRate: 0.07, cashRounding: "none", planCode: "free", trialEndsAt: null, settings: null },
    branches: over.branches ?? [{ id: "br-1", code: "BR1", name: "อารีย์", address: null, phone: null, day_cutoff: "04:00:00", opening_hours: {}, service_charge_rate: 0, stock_location_id: "loc-1", tables: [], stations: [] }],
    channels: over.channels ?? [],
    paymentMethods: over.paymentMethods ?? [],
    suppliers: [],
    ingredients: [],
    menuCategories: [],
    menuItems: [],
    modifierGroups: [],
    roles: [{ id: "r-1", key: "owner", name: "เจ้าของร้าน", description: null, grants_all: true, home: "/today", color: null, permissions: ["*"] }],
    members: db.members.map((m) => ({ id: m.id, display_name: m.name, nickname: null, status: "active", all_branches: true, role_key: "owner", max_discount_rate: 1, branch_ids: null })),
  };
}

const channel = (over: Partial<ShopApiResponse["channels"][number]> = {}): ShopApiResponse["channels"][number] => ({
  id: "ch-1",
  key: "grab",
  kind: "delivery_platform",
  name: "Grab",
  color: null,
  applies_service_charge: false,
  commission_rate: 0.3,
  price_markup: 0.1,
  settlement_days: 7,
  is_active: true,
  ...over,
});

describe("HttpDataSource settings", () => {
  beforeEach(() => {
    clearApiSession();
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    useSabai.getState().reset("demo");
    useSabai.getState().signIn("m-owner");
    // The store knows the branch the calls are for.
    const branchId = useSabai.getState().session.branchId!;
    useSabai.getState().patch((d) => {
      d.branches = d.branches.map((b) => ({ ...b, id: b.id === branchId ? "br-1" : b.id }));
    });
    useSabai.getState().setBranch("br-1");
    useSabai.getState().patch((d) => {
      d.channels = [{ ...d.channels[0]!, id: "ch-1", commissionRate: 0.3, priceMarkup: 0.1 }];
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the shop's own settings — business, branches, channels, ways to be paid — and leaves the rest alone", async () => {
    const items = useSabai.getState().db.menuItems.length;
    fakeApi({ "GET /v1/shop": { body: shop({ name: "ร้านใหม่", channels: [channel({ price_markup: 0.2 })] }) } });
    await ds.load(["settings"]);
    const { db } = useSabai.getState();
    expect(db.tenant.name).toBe("ร้านใหม่");
    expect(db.channels.map((c) => [c.id, c.priceMarkup])).toEqual([["ch-1", 0.2]]);
    expect(db.branches[0]).toMatchObject({ dayCutoff: "04:00" });
    expect(db.menuItems).toHaveLength(items);
  });

  it("changes the business's details, sending only what changed, and nothing when nothing did", async () => {
    const calls = fakeApi({ "PATCH /v1/tenant": { body: { id: "t-1" } }, "GET /v1/shop": { body: shop() } });
    await ds.updateTenant({ name: " ร้านแก้ ", vatRegistered: true, cashRounding: "0.25", businessType: "bakery", pricesIncludeVat: false });
    await ds.updateTenant({});
    expect(calls.filter((c) => c.key.startsWith("PATCH")).map((c) => c.body)).toEqual([{ name: "ร้านแก้", businessType: "bakery", vatRegistered: true, pricesIncludeVat: false, cashRounding: "0.25" }]);
  });

  it("opens a branch with a code the shop does not have yet, and gives back the branch the shop now holds", async () => {
    const calls = fakeApi({
      "POST /v1/branches": { status: 201, body: { id: "br-2" } },
      "GET /v1/shop": {
        body: shop({
          branches: [
            { id: "br-1", code: "BR1", name: "อารีย์", address: null, phone: null, day_cutoff: "04:00:00", opening_hours: {}, service_charge_rate: 0, stock_location_id: "loc-1", tables: [], stations: [] },
            { id: "br-2", code: "BR2", name: "ทองหล่อ", address: "ซอย 55", phone: null, day_cutoff: "04:00:00", opening_hours: {}, service_charge_rate: 0, stock_location_id: "loc-2", tables: [], stations: [] },
          ],
        }),
      },
    });
    useSabai.getState().patch((d) => {
      d.branches = d.branches.slice(0, 1).map((b) => ({ ...b, code: "BR1" }));
    });
    const created = await ds.addBranch({ name: " ทองหล่อ ", address: "ซอย 55", phone: "" });
    expect(calls[0]!.body).toEqual({ code: "BR2", name: "ทองหล่อ", address: "ซอย 55" });
    expect(created).toMatchObject({ id: "br-2", name: "ทองหล่อ" });
  });

  it("does not reuse a branch code someone already has", async () => {
    useSabai.getState().patch((d) => {
      d.branches = [{ ...d.branches[0]!, code: "BR1" }, { ...d.branches[0]!, id: "x", code: "BR2" }];
    });
    const calls = fakeApi({ "POST /v1/branches": { status: 201, body: { id: "br-3" } }, "GET /v1/shop": { body: shop() } });
    await ds.addBranch({ name: "สาขาสาม" }).catch(() => undefined);
    expect(calls[0]!.body.code).toBe("BR3");
  });

  it("edits a branch — hours as written, cutoff as HH:MM, service charge as a fraction", async () => {
    const calls = fakeApi({ "PATCH /v1/branches/br-1": { body: { id: "br-1" } }, "GET /v1/shop": { body: shop() } });
    await ds.updateBranch("br-1", { name: "อารีย์", address: "ซอยอารีย์", phone: "021234567", openingHours: "07:00–21:00", dayCutoff: "05:00", serviceChargeRate: 0.1 });
    expect(calls[0]!.body).toEqual({ name: "อารีย์", address: "ซอยอารีย์", phone: "021234567", openingHours: "07:00–21:00", dayCutoff: "05:00", serviceChargeRate: 0.1 });
  });

  it("turns a channel on or off, and changes its markup, without touching the GP", async () => {
    const calls = fakeApi({ "PATCH /v1/channels/ch-1": { body: { id: "ch-1" } }, "GET /v1/shop": { body: shop({ channels: [channel()] }) } });
    await ds.updateChannel("ch-1", { active: false });
    await ds.updateChannel("ch-1", { priceMarkup: 0.15, commissionRate: 0.3 });
    expect(calls.filter((c) => c.key.startsWith("PATCH")).map((c) => c.body)).toEqual([{ active: false }, { priceMarkup: 0.15 }]);
    expect(calls.some((c) => c.key.includes("commission-rate"))).toBe(false);
  });

  it("gives a changed GP its own rate that starts today, so earlier bills keep theirs", async () => {
    const calls = fakeApi({ "POST /v1/channels/ch-1/commission-rate": { body: { id: "ch-1" } }, "PATCH /v1/channels/ch-1": { body: {} }, "GET /v1/shop": { body: shop({ channels: [channel({ commission_rate: 0.25 })] }) } });
    await ds.updateChannel("ch-1", { commissionRate: 0.25, priceMarkup: 0.1 });
    const rate = calls.find((c) => c.key.includes("commission-rate"))!;
    expect(rate.body.rate).toBe(0.25);
    expect(rate.body.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Only the GP changed (the markup is the same), so the channel row itself is not written.
    expect(calls.some((c) => c.key === "PATCH /v1/channels/ch-1")).toBe(false);
    expect(useSabai.getState().db.channels[0]!.commissionRate).toBe(0.25);
  });

  it("sets a GP from a chosen date", async () => {
    const calls = fakeApi({ "POST /v1/channels/ch-1/commission-rate": { body: {} }, "GET /v1/shop": { body: shop({ channels: [channel()] }) } });
    await ds.setChannelCommission("ch-1", 0.28, "2026-12-01", "เจรจาสัญญาใหม่");
    expect(calls[0]!.body).toEqual({ rate: 0.28, validFrom: "2026-12-01", note: "เจรจาสัญญาใหม่" });
  });

  it("turns a way of being paid on, with the shop's PromptPay number and fee", async () => {
    const calls = fakeApi({ "PATCH /v1/payment-methods/pm-1": { body: { id: "pm-1" } }, "GET /v1/shop": { body: shop() } });
    await ds.updatePaymentMethod("pm-1", { promptpayId: "0891234567", active: true, feeRate: 0 });
    await ds.updatePaymentMethod("pm-1", {});
    expect(calls.filter((c) => c.key.startsWith("PATCH")).map((c) => c.body)).toEqual([{ promptpayId: "0891234567", active: true, feeRate: 0 }]);
  });

  const billingApi = (over: Record<string, unknown> = {}) => ({
    mode: "invoice",
    planCode: "pro",
    status: "trialing",
    billingCycle: "monthly",
    stage: { kind: "trial", daysLeft: 9, grow: true },
    trialEndsAt: "2026-10-09T05:00:00.000Z",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    graceDays: 14,
    openInvoice: null,
    invoices: [],
    ...over,
  });
  const invoiceApi = {
    id: "inv-1",
    invoiceNo: "INV-2610-00001",
    status: "open",
    kind: "plan_change",
    planCode: "pro",
    billingCycle: "yearly",
    subtotal: "13925.23",
    vatAmount: "974.77",
    total: "14900.00",
    periodStart: "2026-09-30",
    periodEnd: "2027-09-29",
    dueAt: "2026-10-03T02:00:00.000Z",
    paidAt: null,
    createdAt: "2026-09-30T02:00:00.000Z",
    payment: { method: "transfer", reference: "INV-2610-00001", amount: "14900.00", promptpayId: "0105536001239", bankName: null, accountNo: "123-4-56789-0", accountName: null },
  };

  it("changes the plan and reloads, and passes on a refusal", async () => {
    const calls = fakeApi({ "POST /v1/settings/plan": { body: { applied: true, planCode: "pro", invoice: null } }, "GET /v1/shop": { body: shop() }, "GET /v1/billing": { body: billingApi() } });
    const r = await ds.changePlan("pro");
    expect(r).toEqual({ applied: true, invoice: null });
    expect(calls[0]).toEqual({ key: "POST /v1/settings/plan", body: { planCode: "pro", billingCycle: "monthly" } });
    // It reads the shop and the bill again: both may have changed.
    expect(calls.map((c) => c.key)).toEqual(expect.arrayContaining(["GET /v1/shop", "GET /v1/billing"]));
    fakeApi({ "POST /v1/settings/plan": { status: 402, body: { error: { code: "FEATURE_NOT_IN_PLAN" } } } });
    await expect(ds.changePlan("enterprise")).rejects.toMatchObject({ code: "FEATURE_NOT_IN_PLAN" });
  });

  it("asks for a yearly plan, and hands back the invoice to pay with its money in satang", async () => {
    const calls = fakeApi({
      "POST /v1/settings/plan": { body: { applied: false, planCode: "pro", invoice: invoiceApi } },
      "GET /v1/shop": { body: shop() },
      "GET /v1/billing": { body: billingApi({ openInvoice: invoiceApi, invoices: [invoiceApi] }) },
    });
    const r = await ds.changePlan("pro", "yearly");
    expect(calls[0]!.body).toEqual({ planCode: "pro", billingCycle: "yearly" });
    expect(r.applied).toBe(false);
    expect(r.invoice).toMatchObject({ invoiceNo: "INV-2610-00001", total: 1_490_000, vatAmount: 97_477, subtotal: 1_392_523 });
    expect(r.invoice!.payment).toMatchObject({ amount: 1_490_000, reference: "INV-2610-00001", promptpayId: "0105536001239" });
    // The bill in the store is what the server says.
    const b = useSabai.getState().db.billing!;
    expect(b.mode).toBe("invoice");
    expect(b.openInvoice!.id).toBe("inv-1");
    expect(b.stage).toEqual({ kind: "trial", daysLeft: 9, grow: true });
  });

  it("withdraws a plan-change invoice and reads the bill again; a renewal is refused by the server and passed on", async () => {
    const calls = fakeApi({ "POST /v1/billing/invoices/inv-1/void": { body: { ok: true } }, "GET /v1/billing": { body: billingApi() } });
    await ds.voidInvoice("inv-1");
    expect(calls.map((c) => c.key)).toEqual(["POST /v1/billing/invoices/inv-1/void", "GET /v1/billing"]);
    expect(useSabai.getState().db.billing!.openInvoice).toBeNull();
    fakeApi({ "POST /v1/billing/invoices/inv-2/void": { status: 422, body: { error: { code: "VALIDATION" } } } });
    await expect(ds.voidInvoice("inv-2")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("reads the bill only for the slice 'billing', and a person who may not see it is not an error for the rest", async () => {
    fakeApi({ "GET /v1/billing": { status: 403, body: { error: { code: "PERMISSION_DENIED" } } } });
    await expect(ds.load(["billing"])).resolves.toBeUndefined();
    expect(useSabai.getState().db.billing).toBeUndefined();
  });
});
