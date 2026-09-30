import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSabai } from "../demo/store";
import { clearApiSession, setApiSession } from "./http-client";
import { httpDataSource as ds } from "./http-data-source";
import type { ShopApiResponse } from "./mappers";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeApi(routes: Record<string, { status?: number; body: unknown } | ((body: any) => { status?: number; body: unknown })>) {
  const calls: { key: string; body: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: any) => {
      const u = new URL(String(url));
      const key = `${init?.method ?? "GET"} ${u.pathname}`;
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ key, body });
      const r = routes[key];
      const res = typeof r === "function" ? r(body) : r;
      return res ? json(res.status ?? 200, res.body) : json(404, { error: { code: "NOT_FOUND" } });
    }),
  );
  return calls;
}

const member = (id: string, name: string, over: Partial<ShopApiResponse["members"][number]> = {}): ShopApiResponse["members"][number] => ({
  id,
  display_name: name,
  nickname: null,
  status: "active",
  all_branches: true,
  role_key: "waiter",
  max_discount_rate: 0,
  branch_ids: null,
  ...over,
});

function shopWith(branchId: string, members: ShopApiResponse["members"], waiterPermissions = ["pos.order"]): ShopApiResponse {
  return {
    tenant: { name: "ร้านทดสอบ", businessType: "cafe", vatRegistered: false, pricesIncludeVat: true, vatRate: 0.07, cashRounding: "none", planCode: "free", trialEndsAt: null, settings: null },
    branches: [{ id: branchId, code: "A", name: "อารีย์", address: null, phone: null, day_cutoff: "04:00:00", service_charge_rate: 0, stock_location_id: "loc-1", tables: [], stations: [] }],
    channels: [],
    paymentMethods: [],
    suppliers: [],
    ingredients: [],
    menuCategories: [],
    menuItems: [],
    modifierGroups: [],
    roles: [
      { id: "r-owner", key: "owner", name: "เจ้าของร้าน", description: null, grants_all: true, home: "/today", color: null, permissions: ["*"] },
      { id: "r-waiter", key: "waiter", name: "เสิร์ฟ", description: null, grants_all: false, home: "/pos", color: null, permissions: waiterPermissions },
    ],
    members,
  };
}

describe("HttpDataSource team", () => {
  let branchId: string;
  beforeEach(() => {
    clearApiSession();
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    useSabai.getState().reset("demo");
    useSabai.getState().signIn("m-owner");
    branchId = useSabai.getState().session.branchId!;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the people and roles from the shop, leaving the rest of the store alone", async () => {
    const before = useSabai.getState().db.menuItems.length;
    fakeApi({ "GET /v1/shop": { body: shopWith(branchId, [member("m-1", "น้องเอ", { role_key: "waiter", branch_ids: [branchId], all_branches: false }), member("m-2", "พี่บี", { status: "suspended" })], ["pos.order", "pos.pay"]) } });
    await ds.load(["team"]);
    const { db } = useSabai.getState();
    expect(db.members.map((m) => [m.id, m.name, m.active, m.branchIds])).toEqual([["m-1", "น้องเอ", true, [branchId]], ["m-2", "พี่บี", false, "all"]]);
    expect(db.roles.find((r) => r.key === "waiter")).toMatchObject({ id: "r-waiter", permissions: ["pos.order", "pos.pay"] });
    expect(db.menuItems).toHaveLength(before);
  });

  it("adds a person with the PIN chosen and hands it back, though the server keeps only a hash", async () => {
    const calls = fakeApi({
      "POST /v1/members": { status: 201, body: { id: "m-9" } },
      "GET /v1/shop": { body: shopWith(branchId, [member("m-9", "น้องใหม่")]) },
    });
    const created = await ds.addMember({ name: " น้องใหม่ ", roleKey: "waiter", pin: "4321", branchIds: "all", maxDiscountRate: 0.1 });
    expect(calls[0]!.body).toEqual({ displayName: "น้องใหม่", roleKey: "waiter", pin: "4321", maxDiscountRate: 0.1 });
    expect(created).toMatchObject({ id: "m-9", name: "น้องใหม่", pin: "4321" });
    // The PIN is for the screen to show once; it is not kept with the person in the store.
    expect(useSabai.getState().db.members.find((m) => m.id === "m-9")!.pin).not.toBe("4321");
  });

  it("scopes a new person to a chosen branch", async () => {
    const calls = fakeApi({ "POST /v1/members": { status: 201, body: { id: "m-9" } }, "GET /v1/shop": { body: shopWith(branchId, [member("m-9", "น้องใหม่")]) } });
    await ds.addMember({ name: "น้องใหม่", roleKey: "waiter", pin: "4321", branchIds: [branchId] });
    expect(calls[0]!.body.branchIds).toEqual([branchId]);
  });

  it("passes on the database's refusal of a PIN somebody already uses", async () => {
    fakeApi({ "POST /v1/members": { status: 422, body: { error: { code: "PIN_IN_USE" } } } });
    await expect(ds.addMember({ name: "ซ้ำ", roleKey: "waiter", pin: "1111", branchIds: "all" })).rejects.toMatchObject({ code: "PIN_IN_USE" });
  });

  it("changes a person's role, discount limit, branches and whether they are active", async () => {
    const calls = fakeApi({ "PATCH /v1/members/m-1": { body: { id: "m-1" } }, "GET /v1/shop": { body: shopWith(branchId, [member("m-1", "น้องเอ")]) } });
    await ds.updateMember("m-1", { roleKey: "waiter", maxDiscountRate: 0.2, name: " น้องเอ " });
    await ds.updateMember("m-1", { active: false });
    await ds.updateMember("m-1", { active: true });
    await ds.updateMember("m-1", { branchIds: "all" });
    await ds.updateMember("m-1", { branchIds: [branchId] });
    expect(calls.filter((c) => c.key.startsWith("PATCH")).map((c) => c.body)).toEqual([
      { displayName: "น้องเอ", roleKey: "waiter", maxDiscountRate: 0.2 },
      { status: "suspended" },
      { status: "active" },
      { allBranches: true },
      { branchIds: [branchId] },
    ]);
  });

  it("asks nothing of the server when there is nothing to change", async () => {
    const calls = fakeApi({});
    await ds.updateMember("m-1", {});
    expect(calls).toEqual([]);
  });

  it("passes on refusals to lock yourself out or drop the last owner", async () => {
    fakeApi({ "PATCH /v1/members/m-1": { status: 422, body: { error: { code: "CANNOT_DEACTIVATE_SELF" } } }, "PATCH /v1/members/m-2": { status: 422, body: { error: { code: "LAST_OWNER" } } } });
    await expect(ds.updateMember("m-1", { active: false })).rejects.toMatchObject({ code: "CANNOT_DEACTIVATE_SELF" });
    await expect(ds.updateMember("m-2", { roleKey: "waiter" })).rejects.toMatchObject({ code: "LAST_OWNER" });
  });

  it("sets a new PIN without reloading anything, since PINs are never sent back", async () => {
    const calls = fakeApi({ "POST /v1/members/m-1/pin": { body: { ok: true } } });
    await ds.resetMemberPin("m-1", "2468");
    expect(calls).toEqual([{ key: "POST /v1/members/m-1/pin", body: { pin: "2468" } }]);
  });

  it("sets a role's rights by the role's id, then reloads so the menu follows", async () => {
    // First load the roles so the store knows their ids.
    fakeApi({ "GET /v1/shop": { body: shopWith(branchId, [member("m-1", "น้องเอ")]) } });
    await ds.load(["team"]);
    const calls = fakeApi({ "PUT /v1/roles/r-waiter/permissions": { body: { id: "r-waiter" } }, "GET /v1/shop": { body: shopWith(branchId, [member("m-1", "น้องเอ")], ["pos.order", "pos.discount"]) } });
    await ds.setRolePermissions("waiter", ["pos.order", "pos.discount"]);
    expect(calls[0]).toEqual({ key: "PUT /v1/roles/r-waiter/permissions", body: { permissions: ["pos.order", "pos.discount"] } });
    expect(useSabai.getState().db.roles.find((r) => r.key === "waiter")!.permissions).toEqual(["pos.order", "pos.discount"]);
  });

  it("does not guess a role's id", async () => {
    fakeApi({});
    await expect(ds.setRolePermissions("no-such-role", [])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
