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

/** The smallest shop response that still has the branch the store is signed into and one menu item. */
function shopWith(branchId: string, menuItems: ShopApiResponse["menuItems"]): ShopApiResponse {
  const { db } = useSabai.getState();
  return {
    tenant: { name: "ร้านทดสอบ", businessType: "cafe", vatRegistered: false, pricesIncludeVat: true, vatRate: 0.07, cashRounding: "none", planCode: "free", trialEndsAt: null, settings: null },
    branches: [{ id: branchId, code: "A", name: "อารีย์", address: null, phone: null, day_cutoff: "04:00:00", service_charge_rate: 0, stock_location_id: "loc-1", tables: [], stations: [] }],
    channels: [],
    paymentMethods: [],
    suppliers: [],
    ingredients: [],
    menuCategories: [{ id: "cat-1", name: "กาแฟ", color: null, icon: "☕", sort: 1 }],
    menuItems,
    modifierGroups: [],
    roles: [{ id: "r-1", key: "owner", name: "เจ้าของร้าน", description: null, grants_all: true, home: "/today", color: null, permissions: ["*"] }],
    members: db.members.map((m) => ({ id: m.id, display_name: m.name, nickname: null, status: "active", all_branches: true, role_key: "owner", max_discount_rate: 1, branch_ids: null })),
  };
}

const item = (over: Partial<ShopApiResponse["menuItems"][number]> = {}): ShopApiResponse["menuItems"][number] => ({
  id: "mi-1",
  category_id: "cat-1",
  name: "ลาเต้เย็น",
  name_en: null,
  emoji: "🧋",
  kitchen_route: "bar",
  tags: [],
  price: "65.00",
  is_active: true,
  modifierGroupIds: [],
  recipe: [],
  ...over,
});

describe("HttpDataSource menu", () => {
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

  it("adds an item with its picture, price in baht, station, new category and recipe, and gives back the item the shop now holds", async () => {
    const calls = fakeApi({
      "POST /v1/menu-items": { body: { id: "mi-1", name: "ลาเต้เย็น", price: "65.00" } },
      "GET /v1/shop": { body: shopWith(branchId, [item({ recipe: [{ ingredientId: "ing-1", qty: 180, wasteRate: 0.02 }] })]) },
    });
    const created = await ds.addMenuItem({ name: " ลาเต้เย็น ", emoji: "🧋", categoryName: " กาแฟ ", price: 6500, route: "bar", recipe: { yieldQty: 1, lines: [{ ingredientId: "ing-1", qty: 180, wasteRate: 0.02 }] } });
    expect(calls[0]!.body).toEqual({ name: "ลาเต้เย็น", emoji: "🧋", price: "65.00", kitchenRoute: "bar", categoryName: "กาแฟ", recipe: [{ ingredientId: "ing-1", qty: 180, wasteRate: 0.02 }] });
    expect(created).toMatchObject({ id: "mi-1", price: 6500, emoji: "🧋", route: "bar" });
    expect(useSabai.getState().db.menuItems.map((m) => m.id)).toEqual(["mi-1"]);
  });

  it("sends an existing category by id, and no recipe when there are no lines", async () => {
    const calls = fakeApi({ "POST /v1/menu-items": { body: { id: "mi-1" } }, "GET /v1/shop": { body: shopWith(branchId, [item()]) } });
    await ds.addMenuItem({ name: "ลาเต้เย็น", emoji: "🧋", categoryId: "cat-1", categoryName: "ไม่ควรถูกส่ง", price: 6500, route: "bar", recipe: { yieldQty: 1, lines: [] } });
    expect(calls[0]!.body.categoryId).toBe("cat-1");
    expect(calls[0]!.body.categoryName).toBeUndefined();
    expect(calls[0]!.body.recipe).toBeUndefined();
  });

  it("says so when the item was saved but the reloaded shop does not have it, rather than returning something made up", async () => {
    fakeApi({ "POST /v1/menu-items": { body: { id: "mi-9" } }, "GET /v1/shop": { status: 500, body: { error: { code: "INTERNAL" } } } });
    await expect(ds.addMenuItem({ name: "x", emoji: "🍽️", categoryId: "cat-1", price: 100, route: "kitchen" })).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("changes the price and recipe in one request and reloads the shop", async () => {
    const calls = fakeApi({ "PATCH /v1/menu-items/mi-1": { body: {} }, "GET /v1/shop": { body: shopWith(branchId, [item({ price: "75.00" })]) } });
    await ds.updateMenuItem("mi-1", { price: 7500, recipe: { yieldQty: 1, lines: [{ ingredientId: "ing-1", qty: 18 }] } });
    expect(calls[0]!.body).toEqual({ price: "75.00", recipe: [{ ingredientId: "ing-1", qty: 18, wasteRate: 0 }] });
    expect(useSabai.getState().db.menuItems.find((m) => m.id === "mi-1")!.price).toBe(7500);
  });

  it("clears the recipe when the key is there but empty, and leaves it alone when the key is absent", async () => {
    const calls = fakeApi({ "PATCH /v1/menu-items/mi-1": { body: {} }, "GET /v1/shop": { body: shopWith(branchId, [item()]) } });
    await ds.updateMenuItem("mi-1", { recipe: undefined });
    await ds.updateMenuItem("mi-1", { price: 7000 });
    expect(calls.filter((c) => c.key.startsWith("PATCH")).map((c) => c.body)).toEqual([{ recipe: [] }, { price: "70.00" }]);
  });

  it("does nothing, and asks nothing of the server, when there is nothing to change", async () => {
    const calls = fakeApi({});
    await ds.updateMenuItem("mi-1", {});
    expect(calls).toEqual([]);
  });

  it("still reports success when only the reload afterwards failed", async () => {
    fakeApi({ "PATCH /v1/menu-items/mi-1": { body: {} }, "GET /v1/shop": { status: 500, body: {} } });
    await expect(ds.updateMenuItem("mi-1", { price: 7000 })).resolves.toBeUndefined();
  });
});

describe("reloading the shop", () => {
  it("keeps which items are sold out in each branch, since the shop itself does not say", async () => {
    clearApiSession();
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    useSabai.getState().reset("demo");
    useSabai.getState().signIn("m-owner");
    const branchId = useSabai.getState().session.branchId!;
    useSabai.getState().patch((d) => {
      d.menuItems = [{ ...d.menuItems[0]!, id: "mi-1", soldOut: { [branchId]: true } }];
    });
    fakeApi({ "GET /v1/shop": { body: shopWith(branchId, [item(), item({ id: "mi-2", name: "อเมริกาโน่" })]) } });
    await ds.load(["bootstrap"]);
    const items = useSabai.getState().db.menuItems;
    expect(items.map((m) => m.id)).toEqual(["mi-1", "mi-2"]);
    expect(items[0]!.soldOut).toEqual({ [branchId]: true });
    expect(items[1]!.soldOut).toEqual({});
    vi.unstubAllGlobals();
  });
});
