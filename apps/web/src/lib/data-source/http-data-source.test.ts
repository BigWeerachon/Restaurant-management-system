import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "../demo/engine";
import { useSabai } from "../demo/store";
import { devLogin, listShops, openShop } from "./connect";
import { clearApiSession, getApiSession, setApiSession } from "./http-client";
import { httpDataSource } from "./http-data-source";
import type { ShopApiResponse } from "./mappers";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function shop(members: ShopApiResponse["members"]): ShopApiResponse {
  return {
    tenant: { name: "ร้านทดสอบ", businessType: "cafe", vatRegistered: false, pricesIncludeVat: true, vatRate: 0.07, cashRounding: "none", planCode: "free", trialEndsAt: null, settings: null },
    branches: [{ id: "br-1", code: "A", name: "อารีย์", address: null, phone: null, day_cutoff: "04:00:00", service_charge_rate: 0, tables: [], stations: [] }],
    channels: [],
    paymentMethods: [],
    suppliers: [],
    ingredients: [],
    menuCategories: [],
    menuItems: [],
    modifierGroups: [],
    roles: [
      { id: "r-1", key: "owner", name: "เจ้าของร้าน", description: null, grants_all: true, home: "/today", color: null, permissions: ["*"] },
      { id: "r-2", key: "cashier", name: "แคชเชียร์", description: null, grants_all: false, home: "/pos", color: null, permissions: ["pos.pay"] },
    ],
    members,
  };
}

const owner = { id: "m-1", display_name: "คุณเอ", nickname: null, status: "active", all_branches: true, role_key: "owner", max_discount_rate: 1, branch_ids: null };
const cashier = { id: "m-2", display_name: "แพรว", nickname: null, status: "active", all_branches: false, role_key: "cashier", max_discount_rate: 0.1, branch_ids: ["br-1"] };

describe("HttpDataSource", () => {
  beforeEach(() => {
    clearApiSession();
    useSabai.getState().reset("demo");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects: logs in, finds the shops, and replaces the demo data with the real shop", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { token: "user-token", userId: "u-1" }))
      .mockResolvedValueOnce(json(200, { memberships: [{ tenantId: "t-1", tenantName: "ร้านทดสอบ" }, { tenantId: "t-1", tenantName: "ร้านทดสอบ" }] }))
      .mockResolvedValueOnce(json(200, shop([owner, cashier])));
    vi.stubGlobal("fetch", fetchMock);
    expect(useSabai.getState().db.orders.length).toBeGreaterThan(0);

    await devLogin("owner@sabai.dev");
    const shops = await listShops();
    expect(shops).toEqual([{ tenantId: "t-1", tenantName: "ร้านทดสอบ" }]);
    await openShop("t-1");

    const { db } = useSabai.getState();
    expect(getApiSession()).toMatchObject({ token: "user-token", tenantId: "t-1" });
    expect(db.tenant.name).toBe("ร้านทดสอบ");
    expect(db.members.map((m) => m.name)).toEqual(["คุณเอ", "แพรว"]);
    expect(db.orders).toEqual([]);
    expect(fetchMock.mock.calls[2]![1].headers["X-Tenant-Id"]).toBe("t-1");
  });

  it("signs a person in by PIN: keeps their token, and their member becomes the session", async () => {
    setApiSession({ token: "user-token", tenantId: "t-1" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(200, shop([owner, cashier])))
        .mockResolvedValueOnce(json(200, { token: "staff-token", expiresAt: "2026-09-30T00:00:00Z", membership: { id: "m-2", displayName: "แพรว", role: "cashier", home: "/pos" } })),
    );
    await httpDataSource.load(["bootstrap"]);

    const member = await httpDataSource.pinSwitch("br-1", "3333");
    expect(member).toMatchObject({ id: "m-2", roleKey: "cashier" });
    expect(getApiSession().token).toBe("staff-token");
    expect(useSabai.getState().session).toEqual({ memberId: "m-2", branchId: "br-1" });
  });

  it("reloads the shop when the person who entered a PIN is new to this device", async () => {
    setApiSession({ token: "user-token", tenantId: "t-1" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(200, shop([owner])))
        .mockResolvedValueOnce(json(200, { token: "staff-token", expiresAt: "x", membership: { id: "m-2", displayName: "แพรว", role: "cashier", home: "/pos" } }))
        .mockResolvedValueOnce(json(200, shop([owner, cashier]))),
    );
    await httpDataSource.load(["bootstrap"]);
    expect((await httpDataSource.pinSwitch("br-1", "3333")).id).toBe("m-2");
  });

  it("reports a wrong PIN with the API's own error and keeps the earlier token", async () => {
    setApiSession({ token: "user-token", tenantId: "t-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: { code: "PIN_INVALID" } })));
    await expect(httpDataSource.pinSwitch("br-1", "0000")).rejects.toMatchObject({ code: "PIN_INVALID" });
    expect(getApiSession().token).toBe("user-token");
  });

  it("asks the API to approve a sensitive action by manager PIN and hands back the one-time approval id", async () => {
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    const fetchMock = vi.fn().mockResolvedValue(json(201, { approvalId: "ap-1", expiresAt: "2026-09-29T06:00:00Z" }));
    vi.stubGlobal("fetch", fetchMock);
    const branchId = useSabai.getState().db.branches[0]!.id;
    useSabai.getState().setBranch(branchId);

    const token = await httpDataSource.approve("pos.discount", "2222", { type: "order", id: "o-1" }, "ลูกค้าประจำ");

    expect(token).toEqual({ value: "ap-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/approvals");
    expect(JSON.parse(init.body)).toEqual({ branchId, permission: "pos.discount", pin: "2222", targetType: "order", targetId: "o-1", reason: "ลูกค้าประจำ" });
    expect(init.headers["Idempotency-Key"]).toBeTruthy();
  });

  it("shows the API's reason when the manager PIN is wrong or the approver may not approve this", async () => {
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(422, { error: { code: "APPROVAL_PIN_INVALID" } })));
    await expect(httpDataSource.approve("pos.void", "0000")).rejects.toMatchObject({ code: "APPROVAL_PIN_INVALID" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { error: { code: "APPROVER_NOT_ALLOWED", details: { permission: "pos.refund" } } })));
    await expect(httpDataSource.approve("pos.refund", "3333")).rejects.toMatchObject({ code: "APPROVER_NOT_ALLOWED", params: { permission: "pos.refund" } });
  });

  it("signs out completely: the token is forgotten, not just the local session", async () => {
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    await httpDataSource.signOut();
    expect(getApiSession()).toEqual({ token: null, tenantId: null });
  });

  it("refuses commands that are not wired to the API yet instead of changing only the local copy", async () => {
    const ds = httpDataSource;
    await expect(ds.closeDay("2026-09-29")).rejects.toBeInstanceOf(DomainError);
    await expect(ds.closeDay("2026-09-29")).rejects.toMatchObject({ code: "INTERNAL", params: { feature: "closeDay" } });
    await expect(ds.load(["finance"])).rejects.toMatchObject({ code: "INTERNAL", params: { feature: "load(finance)" } });
    await expect(ds.signIn("m-1")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
