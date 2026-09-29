import { accessFromRole, can, type Permission } from "@sabai/domain";
import { describe, expect, it } from "vitest";
import { guessEmoji, mapShopBootstrap, type ShopApiResponse } from "./mappers";

// Field names and value formats copied from what apps/api/src/routes/shop.ts returns
// (asserted against real Postgres in apps/api/test/api.e2e.test.ts).
function shopFixture(overrides: Partial<ShopApiResponse> = {}): ShopApiResponse {
  return {
    tenant: {
      name: "สบายดี คาเฟ่ & ครัว",
      businessType: "cafe",
      vatRegistered: true,
      pricesIncludeVat: true,
      vatRate: 0.07,
      cashRounding: "none",
      planCode: "pro",
      trialEndsAt: "2026-10-12T00:00:00.000Z",
      settings: { onboarding: { skipped: ["team"], payments_confirmed: true } },
    },
    branches: [
      {
        id: "br-1",
        code: "ARI",
        name: "อารีย์",
        address: null,
        phone: "02-000-0000",
        day_cutoff: "04:00:00",
        service_charge_rate: 0.1,
        tables: [
          { id: "t-1", branch_id: "br-1", area_id: "area-1", area_name: "ระเบียง", name: "B1", seats: 4 },
          { id: "t-2", branch_id: "br-1", area_id: null, area_name: null, name: "ริมทาง", seats: 2 },
        ],
        stations: [{ id: "st-1", branch_id: "br-1", name: "บาร์", route_key: "bar", color: null, warn_after_sec: 300, late_after_sec: 600 }],
      },
    ],
    channels: [
      { id: "ch-1", key: "dine_in", kind: "dine_in", name: "ทานที่ร้าน", color: null, applies_service_charge: true, commission_rate: 0, settlement_days: 0, is_active: true },
      { id: "ch-2", key: "grab", kind: "delivery_platform", name: "Grab", color: "#00b14f", applies_service_charge: false, commission_rate: 0.32, settlement_days: 7, is_active: false },
    ],
    paymentMethods: [
      { id: "pm-1", kind: "cash", name: "เงินสด", fee_rate: 0, is_active: true, settlement_days: 0, requires_reference: false, config: null },
      { id: "pm-2", kind: "promptpay", name: "PromptPay", fee_rate: 0, is_active: true, settlement_days: 1, requires_reference: true, config: { promptpay_id: "0812345678" } },
    ],
    suppliers: [
      {
        id: "su-1",
        name: "ฟาร์มนมสด",
        phone: null,
        line_id: "@farm",
        payment_terms_days: 7,
        lead_time_days: 1,
        items: [{ ingredientId: "ing-milk", packName: "ขวด 2 ลิตร", packQty: 2000, lastPrice: "100.00", isPreferred: true }],
      },
      {
        id: "su-2",
        name: "ตลาดสด",
        phone: null,
        line_id: null,
        payment_terms_days: 0,
        lead_time_days: 0,
        items: [
          { ingredientId: "ing-milk", packName: "แกลลอน 5 ลิตร", packQty: 5000, lastPrice: "230.00", isPreferred: false },
          { ingredientId: "ing-egg", packName: "แผง 30 ฟอง", packQty: 30, lastPrice: null, isPreferred: false },
        ],
      },
    ],
    ingredients: [
      { id: "ing-milk", name: "นมสด", kind: "raw", base_unit: "ml", display_unit: "l", track_stock: true, reorder_point: 1000, par_level: 6000, standard_cost: 0.045, last_cost: 0.05, storage_zone: "ตู้เย็น", category: "นม" },
      { id: "ing-egg", name: "ไข่ไก่", kind: "raw", base_unit: "pcs", display_unit: null, track_stock: true, reorder_point: null, par_level: null, standard_cost: 4, last_cost: null, storage_zone: null, category: null },
      { id: "ing-syrup", name: "น้ำเชื่อม", kind: "prep", base_unit: "ml", display_unit: null, track_stock: false, reorder_point: null, par_level: null, standard_cost: null, last_cost: null, storage_zone: null, category: null },
    ],
    menuCategories: [{ id: "cat-1", name: "กาแฟ", color: "#6f4518", sort: 1 }],
    menuItems: [
      {
        id: "mi-1",
        category_id: "cat-1",
        name: "ลาเต้เย็น",
        name_en: null,
        kitchen_route: "bar",
        tags: [],
        price: "65.00",
        is_active: true,
        modifierGroupIds: ["mg-1"],
        recipe: [{ ingredientId: "ing-milk", qty: 180, wasteRate: 0.02 }],
      },
      { id: "mi-2", category_id: "cat-1", name: "น้ำเปล่า", name_en: "Water", kitchen_route: "bar", tags: ["new"], price: "10.50", is_active: false, modifierGroupIds: [], recipe: [] },
    ],
    modifierGroups: [
      {
        id: "mg-1",
        name: "ระดับหวาน",
        min_select: 1,
        max_select: 1,
        options: [
          { id: "mo-1", group_id: "mg-1", name: "หวานน้อย", price_delta: "0.00", is_default: true },
          { id: "mo-2", group_id: "mg-1", name: "เพิ่มช็อต", price_delta: "15.00", is_default: false },
        ],
      },
    ],
    roles: [
      { id: "r-1", key: "owner", name: "เจ้าของร้าน", description: null, grants_all: true, home: "/today", color: null, permissions: ["*"] },
      { id: "r-2", key: "cashier", name: "แคชเชียร์", description: "ขายหน้าร้าน", grants_all: false, home: "/pos", color: "emerald", permissions: ["pos.order", "pos.pay"] },
    ],
    members: [
      { id: "m-1", display_name: "คุณเอ", nickname: null, status: "active", all_branches: true, role_key: "owner", max_discount_rate: 1, branch_ids: null },
      { id: "m-2", display_name: "แพรว", nickname: "แพร", status: "suspended", all_branches: false, role_key: "cashier", max_discount_rate: 0.1, branch_ids: ["br-1"] },
    ],
    ...overrides,
  };
}

describe("mapShopBootstrap", () => {
  it("turns the tenant, onboarding progress, and plan into the demo's Tenant shape", () => {
    const { tenant } = mapShopBootstrap(shopFixture());
    expect(tenant).toMatchObject({ name: "สบายดี คาเฟ่ & ครัว", plan: "pro", vatRegistered: true, vatRate: 0.07 });
    expect(tenant.onboarding).toEqual({ skipped: ["team"], paymentsConfirmed: true });
  });

  it("falls back to sensible defaults for a shop with no tenant row yet", () => {
    const { tenant } = mapShopBootstrap(shopFixture({ tenant: null }));
    expect(tenant).toMatchObject({ name: "", plan: "free", businessType: "restaurant", onboarding: { skipped: [], paymentsConfirmed: false } });
  });

  it("groups tables by the area's name, never its id, so the POS table picker shows real section headings", () => {
    const { branches } = mapShopBootstrap(shopFixture());
    expect(branches[0]!.tables.map((t) => t.zone)).toEqual(["ระเบียง", "ทั่วไป"]);
    expect(branches[0]!.address).toBeUndefined();
    expect(branches[0]!.phone).toBe("02-000-0000");
  });

  it("lifts kitchen stations out of their branch, keeping the route key the POS sends tickets to", () => {
    const { stations } = mapShopBootstrap(shopFixture());
    expect(stations).toEqual([{ id: "st-1", branchId: "br-1", name: "บาร์", route: "bar", warnAfterSec: 300, lateAfterSec: 600 }]);
  });

  it("keeps channel GP as a rate, payment fees, PromptPay id, and whether a reference is required", () => {
    const { channels, paymentMethods } = mapShopBootstrap(shopFixture());
    expect(channels[1]).toMatchObject({ key: "grab", active: false, commissionRate: 0.32, settlementDays: 7, appliesServiceCharge: false });
    expect(paymentMethods[1]).toMatchObject({ kind: "promptpay", promptpayId: "0812345678", requiresReference: true });
    expect(paymentMethods[0]).toMatchObject({ kind: "cash", promptpayId: undefined, requiresReference: false });
  });

  it("keeps per-unit ingredient costs in baht at full precision — not satang, not rounded", () => {
    const { ingredients } = mapShopBootstrap(shopFixture());
    const milk = ingredients.find((i) => i.id === "ing-milk")!;
    // 0.045 ฿/ml. As satang this would be 5 (0.05 ฿/ml): +11% here and 100x off wherever a cost is later divided down to a unit.
    expect(milk.standardCost).toBe(0.045);
    expect(milk.lastCost).toBe(0.05);
    const syrup = ingredients.find((i) => i.id === "ing-syrup")!;
    expect(syrup.standardCost).toBe(0);
    expect(syrup.lastCost).toBeUndefined();
  });

  it("derives how each ingredient is usually bought from the preferred supplier item, in satang per pack", () => {
    const { ingredients } = mapShopBootstrap(shopFixture());
    const milk = ingredients.find((i) => i.id === "ing-milk")!;
    // su-2 also sells milk (5 L), but su-1's 2 L bottle is the preferred one.
    expect(milk.pack).toEqual({ name: "ขวด 2 ลิตร", qty: 2000, price: 10_000, supplierId: "su-1" });
  });

  it("estimates a pack price from the standard cost when the item was never bought, and leaves unsold ingredients without a pack", () => {
    const { ingredients } = mapShopBootstrap(shopFixture());
    // 30 eggs x ฿4 = ฿120 = 12,000 satang.
    expect(ingredients.find((i) => i.id === "ing-egg")!.pack).toEqual({ name: "แผง 30 ฟอง", qty: 30, price: 12_000, supplierId: "su-2" });
    expect(ingredients.find((i) => i.id === "ing-syrup")!.pack).toBeUndefined();
  });

  it("converts menu and modifier money to satang and keeps recipe lines with their waste rate", () => {
    const { menuItems, modifierGroups } = mapShopBootstrap(shopFixture());
    expect(menuItems[0]).toMatchObject({ price: 6500, route: "bar", active: true, modifierGroupIds: ["mg-1"] });
    expect(menuItems[0]!.recipe).toEqual({ yieldQty: 1, lines: [{ ingredientId: "ing-milk", qty: 180, wasteRate: 0.02 }] });
    expect(menuItems[1]).toMatchObject({ price: 1050, nameEn: "Water", active: false, recipe: undefined, tags: ["new"] });
    expect(menuItems[0]!.tags).toBeUndefined();
    expect(modifierGroups[0]).toMatchObject({ min: 1, max: 1 });
    expect(modifierGroups[0]!.options.map((o) => o.priceDelta)).toEqual([0, 1500]);
  });

  it("models a grants-all role with grantsAll alone, so the '*' marker never reaches the permission editor", () => {
    const { roles } = mapShopBootstrap(shopFixture());
    const owner = roles.find((r) => r.key === "owner")!;
    expect(owner.grantsAll).toBe(true);
    expect(owner.permissions).toEqual([]);
    expect(can(accessFromRole({ grantsAll: owner.grantsAll, permissions: owner.permissions as Permission[] }), "finance.close_day")).toBe(true);
    const cashier = roles.find((r) => r.key === "cashier")!;
    expect(cashier.permissions).toEqual(["pos.order", "pos.pay"]);
    expect(can(accessFromRole({ grantsAll: cashier.grantsAll, permissions: cashier.permissions as Permission[] }), "finance.close_day")).toBe(false);
  });

  it("maps team members with their branch scope, discount cap, and active flag — but never a PIN", () => {
    const { members } = mapShopBootstrap(shopFixture());
    expect(members[0]).toMatchObject({ id: "m-1", name: "คุณเอ", branchIds: "all", maxDiscountRate: 1, active: true, pin: "" });
    expect(members[1]).toMatchObject({ id: "m-2", nickname: "แพร", branchIds: ["br-1"], maxDiscountRate: 0.1, active: false, pin: "" });
  });
});

describe("guessEmoji", () => {
  it("picks a fitting emoji for every item and category on the sample menu", () => {
    const expected: Record<string, string> = {
      // categories
      กาแฟ: "☕",
      "ชา นม โกโก้": "🧋",
      อาหารจานเดียว: "🍛",
      ขนมและเบเกอรี่: "🥐",
      // dishes
      ข้าวกะเพราหมูสับ: "🍛",
      ข้าวกะเพราไก่: "🍛",
      ข้าวผัดกุ้ง: "🍛",
      ข้าวผัดไก่: "🍛",
      ข้าวไข่เจียว: "🍛",
      ผัดซีอิ๊วหมู: "🍜",
      // drinks
      คาปูชิโน่ร้อน: "☕",
      ลาเต้เย็น: "☕",
      อเมริกาโน่เย็น: "☕",
      เอสเพรสโซ่: "☕",
      ชาไทยเย็น: "🧋",
      มอคค่าเย็น: "🧋",
      มัทฉะลาเต้: "🥤",
      โกโก้เย็น: "🥤",
      // bakery
      ครัวซองต์เนยสด: "🥐",
      ฮันนี่โทสต์: "🍞",
      เค้กช็อกโกแลต: "🍰",
    };
    for (const [name, emoji] of Object.entries(expected)) expect(guessEmoji(name), name).toBe(emoji);
  });

  it("tells raw ingredients apart from the dishes they share words with", () => {
    expect(guessEmoji("ไข่ไก่")).toBe("🥚");
    expect(guessEmoji("อกไก่")).toBe("🍗");
    expect(guessEmoji("ข้าวหอมมะลิ")).toBe("🍚");
    expect(guessEmoji("นมสด")).toBe("🥛");
    expect(guessEmoji("ซีอิ๊วขาว", "🥘")).toBe("🥘");
    expect(guessEmoji("ใบกะเพรา")).toBe("🌿");
  });

  it("falls back for anything it does not recognise", () => {
    expect(guessEmoji("อะไรก็ไม่รู้")).toBe("🍽️");
    expect(guessEmoji("อะไรก็ไม่รู้", "🥘")).toBe("🥘");
  });
});
