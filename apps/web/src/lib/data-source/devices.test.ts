import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDevice, resetDeviceForTests, setDevice } from "../device";
import { useSabai } from "../demo/store";
import { devicePinSignIn, fetchRoster, listDevices, registerThisDevice, revokeDevice } from "./devices";
import { clearApiSession, getApiSession, setApiSession } from "./http-client";
import { httpDataSource } from "./http-data-source";
import type { ShopApiResponse } from "./mappers";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const shop = (members: ShopApiResponse["members"]): ShopApiResponse => ({
  tenant: { name: "ร้านทดสอบ", businessType: "cafe", vatRegistered: false, pricesIncludeVat: true, vatRate: 0.07, cashRounding: "none", planCode: "pro", trialEndsAt: null, settings: null },
  branches: [{ id: "br-1", code: "A", name: "อารีย์", address: null, phone: null, day_cutoff: "04:00:00", service_charge_rate: 0, stock_location_id: "loc-1", tables: [], stations: [] }],
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
});
const cashier = { id: "m-2", display_name: "แพรว", nickname: null, status: "active", all_branches: false, role_key: "cashier", max_discount_rate: 0.1, branch_ids: ["br-1"] };

describe("registered tills", () => {
  beforeEach(() => {
    clearApiSession();
    resetDeviceForTests();
    useSabai.getState().reset("demo");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers this browser sending only the SHA-256 of a new secret, and keeps the secret here", async () => {
    setApiSession({ token: "owner-token", tenantId: "t-1" });
    const fetchMock = vi.fn().mockResolvedValue(json(201, { id: "d-1", name: "iPad หน้าร้าน", kind: "pos", branchId: "br-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const device = await registerThisDevice({ name: "iPad หน้าร้าน", kind: "pos", branchId: "br-1" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/devices");
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ branchId: "br-1", name: "iPad หน้าร้าน", kind: "pos" });
    expect(sent.tokenHash).toBe(createHash("sha256").update(device.token).digest("hex"));
    expect(init.body).not.toContain(device.token); // the secret itself never goes over the wire at registration
    expect(init.headers.Authorization).toBe("Bearer owner-token");
    expect(device.token).toMatch(/^sbd_[A-Za-z0-9_-]{43}$/);
    expect(getDevice()).toEqual({ token: device.token, deviceId: "d-1", name: "iPad หน้าร้าน", tenantId: "t-1", branchId: "br-1" });
  });

  it("does not remember a device the server refused to register", async () => {
    setApiSession({ token: "owner-token", tenantId: "t-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(402, { error: { code: "PLAN_LIMIT_REACHED", details: { metric: "devices", limit: 1 } } })));
    await expect(registerThisDevice({ name: "อีกเครื่อง", kind: "kds", branchId: "br-1" })).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
    expect(getDevice()).toBeNull();
  });

  it("lists devices and revokes one; revoking this browser's own also forgets its secret", async () => {
    setApiSession({ token: "owner-token", tenantId: "t-1" });
    setDevice({ token: "sbd_secret", deviceId: "d-1", name: "ของเรา", tenantId: "t-1", branchId: "br-1" });
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, [{ id: "d-1", name: "ของเรา" }])).mockImplementation(async () => json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listDevices()).toEqual([{ id: "d-1", name: "ของเรา" }]);
    await revokeDevice("d-2");
    expect(getDevice()).not.toBeNull(); // someone else's device
    await revokeDevice("d-1");
    expect(getDevice()).toBeNull();
    const [url, init] = fetchMock.mock.calls[2]!;
    expect(String(url)).toContain("/v1/devices/d-1");
    expect(init.method).toBe("DELETE");
  });

  it("asks who can sign in as the device itself: its secret, and no bearer token or shop header", async () => {
    setApiSession({ token: "stale-staff-token", tenantId: "t-1" });
    setDevice({ token: "sbd_secret-value-of-a-till", deviceId: "d-1", name: "จอ", tenantId: "t-1", branchId: "br-1" });
    const roster = { device: { id: "d-1", name: "จอ", kind: "pos" }, tenant: { id: "t-1", name: "ร้านทดสอบ" }, branch: { id: "br-1", name: "อารีย์" }, staff: [] };
    const fetchMock = vi.fn().mockResolvedValue(json(200, roster));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRoster()).toEqual(roster);
    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers["X-Device-Token"]).toBe("sbd_secret-value-of-a-till");
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers["X-Tenant-Id"]).toBeUndefined();
  });

  it("forgets the secret when the server says the device was cancelled", async () => {
    setDevice({ token: "sbd_secret-value-of-a-till", deviceId: "d-1", name: "จอ", tenantId: "t-1", branchId: "br-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: { code: "DEVICE_REVOKED" } })));
    await expect(fetchRoster()).rejects.toMatchObject({ code: "DEVICE_REVOKED" });
    expect(getDevice()).toBeNull();
  });

  it("signs a person in by PIN through the device: their token and shop become the session, starting from this shop's own data", async () => {
    setDevice({ token: "sbd_secret-value-of-a-till", deviceId: "d-1", name: "จอ", tenantId: "t-1", branchId: "br-1" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { token: "staff-token", expiresAt: "x", tenantId: "t-1", branchId: "br-1", membership: { id: "m-2", displayName: "แพรว", role: "cashier", home: "/pos" } }))
      .mockResolvedValueOnce(json(200, shop([cashier])));
    vi.stubGlobal("fetch", fetchMock);
    expect(useSabai.getState().db.orders.length).toBeGreaterThan(0); // demo data is here until the real shop replaces it

    const member = await devicePinSignIn("3333");

    expect(member).toMatchObject({ id: "m-2", roleKey: "cashier" });
    const [, pinInit] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(pinInit.body)).toEqual({ pin: "3333" });
    expect(pinInit.headers["X-Device-Token"]).toBe("sbd_secret-value-of-a-till");
    expect(pinInit.headers.Authorization).toBeUndefined();
    expect(getApiSession()).toEqual({ token: "staff-token", tenantId: "t-1" });
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe("Bearer staff-token");
    expect(useSabai.getState().db.tenant.name).toBe("ร้านทดสอบ");
    expect(useSabai.getState().db.orders).toEqual([]);
    expect(useSabai.getState().session).toEqual({ memberId: "m-2", branchId: "br-1" });
  });

  it("says a wrong PIN is wrong without touching the session, and a cancelled device is forgotten", async () => {
    setDevice({ token: "sbd_secret-value-of-a-till", deviceId: "d-1", name: "จอ", tenantId: "t-1", branchId: "br-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(401, { error: { code: "PIN_INVALID" } })).mockResolvedValueOnce(json(401, { error: { code: "DEVICE_REVOKED" } })));
    await expect(devicePinSignIn("0000")).rejects.toMatchObject({ code: "PIN_INVALID" });
    expect(getApiSession().token).toBeNull();
    expect(getDevice()).not.toBeNull();
    await expect(devicePinSignIn("1111")).rejects.toMatchObject({ code: "DEVICE_REVOKED" });
    expect(getDevice()).toBeNull();
  });

  it("on a registered till, the in-app 'switch user' PIN goes through the device too", async () => {
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    setDevice({ token: "sbd_secret-value-of-a-till", deviceId: "d-1", name: "จอ", tenantId: "t-1", branchId: "br-1" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { token: "other-staff", expiresAt: "x", tenantId: "t-1", branchId: "br-1", membership: { id: "m-2", displayName: "แพรว", role: "cashier", home: "/pos" } }))
      .mockResolvedValueOnce(json(200, shop([cashier])));
    vi.stubGlobal("fetch", fetchMock);
    await httpDataSource.pinSwitch("br-1", "3333");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/v1/auth/device-pin");
    expect(getApiSession().token).toBe("other-staff");
  });

  it("a device registered for another shop is not used for this one's PIN switches", async () => {
    setApiSession({ token: "user-token", tenantId: "t-1" });
    setDevice({ token: "sbd_secret-value-of-a-till", deviceId: "d-9", name: "จอร้านอื่น", tenantId: "t-OTHER", branchId: "br-9" });
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, { token: "staff-token", expiresAt: "x", membership: { id: "m-2", displayName: "แพรว", role: "cashier", home: "/pos" } })).mockResolvedValueOnce(json(200, shop([cashier])));
    vi.stubGlobal("fetch", fetchMock);
    await httpDataSource.pinSwitch("br-1", "3333");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/v1/auth/pin");
  });
});
