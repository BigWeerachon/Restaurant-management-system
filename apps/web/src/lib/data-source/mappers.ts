/**
 * Converts `GET /v1/shop`'s response into the same shape `DemoState` already
 * uses, so every existing page/selector keeps working unchanged once
 * `HttpDataSource` starts filling the store from the API (ADR-0009). Money
 * becomes satang, snake_case becomes camelCase, ids stay as-is (both sides
 * use UUIDs already).
 *
 * One real gap, tracked in docs/v1.1-checklist.md: the database has no
 * `emoji` column yet for ingredients/menu items/categories, so this guesses
 * one from the name. Replace `guessEmoji` with a real column once V1.2 adds
 * it — nothing else needs to change.
 */
import { toSatang } from "@sabai/domain";
import type {
  Branch,
  Channel,
  Ingredient,
  Member,
  MenuCategory,
  MenuItem,
  ModifierGroup,
  PaymentMethod,
  Role,
  Station,
  Supplier,
  Tenant,
} from "../demo/types";

// First match wins, so more specific words come before the ones they contain
// (ขนม contains นม; ไข่ไก่ is an egg, not chicken; ผัดซีอิ๊ว is a dish, ซีอิ๊วขาว is a sauce).
const EMOJI_KEYWORDS: [RegExp, string][] = [
  [/ครัวซองต์|เบเกอรี่|ขนม(?!ปัง)/, "🥐"],
  [/เค้ก/, "🍰"],
  [/โทสต์|ขนมปัง/, "🍞"],
  [/ผัดซีอิ๊ว|เส้น|ก๋วยเตี๋ยว|บะหมี่/, "🍜"],
  [/ใบกะเพรา/, "🌿"],
  [/ผัด|กะเพรา|เจียว|อาหาร|จานเดียว/, "🍛"],
  [/ชา|มอคค่า/, "🧋"],
  [/มัทฉะ|โกโก้/, "🥤"],
  [/กาแฟ|เอสเพรสโซ|อเมริกาโน|คาปูชิโน|ลาเต้/, "☕"],
  [/ช็อกโกแลต/, "🍫"],
  [/นม/, "🥛"],
  [/เนย/, "🧈"],
  [/ไข่/, "🥚"],
  [/ไก่/, "🍗"],
  [/หมู/, "🥩"],
  [/กุ้ง/, "🦐"],
  [/ข้าว/, "🍚"],
  [/ผัก|ใบ/, "🥬"],
  [/น้ำแข็ง/, "🧊"],
  [/น้ำตาล|เชื่อม/, "🍯"],
];

export function guessEmoji(name: string, fallback = "🍽️"): string {
  for (const [pattern, emoji] of EMOJI_KEYWORDS) if (pattern.test(name)) return emoji;
  return fallback;
}

// ---------------------------------------------------------------------------
// Wire shapes (subset of what apps/api/src/routes/shop.ts returns — only the
// fields this mapper reads, kept loose so an unrelated API field never
// breaks the build).
// ---------------------------------------------------------------------------
export interface ShopApiResponse {
  tenant: {
    name: string;
    businessType: Tenant["businessType"];
    vatRegistered: boolean;
    pricesIncludeVat: boolean;
    vatRate: number;
    cashRounding: Tenant["cashRounding"];
    planCode: string | null;
    trialEndsAt: string | null;
    settings: { onboarding?: { skipped?: string[]; payments_confirmed?: boolean } } | null;
  } | null;
  branches: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    phone: string | null;
    day_cutoff: string;
    service_charge_rate: number;
    stock_location_id: string | null;
    tables: { id: string; branch_id: string; area_id: string | null; area_name: string | null; name: string; seats: number }[];
    stations: { id: string; branch_id: string; name: string; route_key: string; color: string | null; warn_after_sec: number; late_after_sec: number }[];
  }[];
  channels: {
    id: string;
    key: string;
    kind: string;
    name: string;
    color: string | null;
    applies_service_charge: boolean;
    commission_rate: number;
    settlement_days: number;
    is_active: boolean;
  }[];
  paymentMethods: {
    id: string;
    kind: string;
    name: string;
    fee_rate: number;
    is_active: boolean;
    settlement_days: number;
    requires_reference: boolean;
    config: { promptpay_id?: string } | null;
  }[];
  suppliers: {
    id: string;
    name: string;
    phone: string | null;
    line_id: string | null;
    payment_terms_days: number;
    lead_time_days: number;
    items: { ingredientId: string; packName: string; packQty: number; lastPrice: string | null; isPreferred: boolean }[];
  }[];
  ingredients: {
    id: string;
    name: string;
    kind: Ingredient["kind"];
    base_unit: Ingredient["baseUnit"];
    display_unit: string | null;
    track_stock: boolean;
    reorder_point: number | null;
    par_level: number | null;
    /** ฿ per base unit at full precision (numeric(18,6)), not satang. */
    standard_cost: number | null;
    last_cost: number | null;
    storage_zone: string | null;
    category: string | null;
  }[];
  menuCategories: { id: string; name: string; color: string | null; sort: number }[];
  menuItems: {
    id: string;
    category_id: string;
    name: string;
    name_en: string | null;
    kitchen_route: string;
    tags: string[];
    price: string;
    is_active: boolean;
    modifierGroupIds: string[];
    recipe: { ingredientId: string; qty: number; wasteRate: number }[];
  }[];
  modifierGroups: {
    id: string;
    name: string;
    min_select: number;
    max_select: number;
    options: { id: string; group_id: string; name: string; price_delta: string; is_default: boolean }[];
  }[];
  roles: { id: string; key: string; name: string; description: string | null; grants_all: boolean; home: string; color: string | null; permissions: string[] }[];
  members: { id: string; display_name: string; nickname: string | null; status: string; all_branches: boolean; role_key: string; max_discount_rate: number; branch_ids: string[] | null }[];
}

export interface ShopBootstrap {
  tenant: Tenant;
  branches: Branch[];
  stations: Station[];
  channels: Channel[];
  paymentMethods: PaymentMethod[];
  suppliers: Supplier[];
  ingredients: Ingredient[];
  menuCategories: MenuCategory[];
  menuItems: MenuItem[];
  modifierGroups: ModifierGroup[];
  roles: Role[];
  members: Member[];
}

export function mapShopBootstrap(shop: ShopApiResponse): ShopBootstrap {
  const tenant: Tenant = {
    name: shop.tenant?.name ?? "",
    businessType: shop.tenant?.businessType ?? "restaurant",
    vatRegistered: shop.tenant?.vatRegistered ?? false,
    pricesIncludeVat: shop.tenant?.pricesIncludeVat ?? true,
    vatRate: shop.tenant?.vatRate ?? 0.07,
    cashRounding: shop.tenant?.cashRounding ?? "none",
    plan: (shop.tenant?.planCode as Tenant["plan"]) ?? "free",
    trialEndsAt: shop.tenant?.trialEndsAt ?? "",
    onboarding: {
      skipped: shop.tenant?.settings?.onboarding?.skipped ?? [],
      paymentsConfirmed: shop.tenant?.settings?.onboarding?.payments_confirmed ?? false,
    },
  };

  const stations: Station[] = shop.branches.flatMap((b) =>
    b.stations.map((s) => ({ id: s.id, branchId: s.branch_id, name: s.name, route: s.route_key, warnAfterSec: s.warn_after_sec, lateAfterSec: s.late_after_sec })),
  );

  const branches: Branch[] = shop.branches.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    address: b.address ?? undefined,
    phone: b.phone ?? undefined,
    dayCutoff: b.day_cutoff,
    serviceChargeRate: b.service_charge_rate,
    stockLocationId: b.stock_location_id ?? undefined,
    tables: b.tables.map((t) => ({ id: t.id, name: t.name, seats: t.seats, zone: t.area_name ?? "ทั่วไป" })),
  }));

  const channels: Channel[] = shop.channels.map((c) => ({
    id: c.id,
    key: c.key,
    kind: c.kind as Channel["kind"],
    name: c.name,
    short: c.name,
    color: c.color ?? "gray",
    active: c.is_active,
    commissionRate: c.commission_rate,
    // No price_markup column yet (tracked gap) — delivery channels show base menu prices until it lands.
    priceMarkup: 0,
    appliesServiceCharge: c.applies_service_charge,
    settlementDays: c.settlement_days,
  }));

  const paymentMethods: PaymentMethod[] = shop.paymentMethods.map((p) => ({
    id: p.id,
    kind: p.kind as PaymentMethod["kind"],
    name: p.name,
    active: p.is_active,
    feeRate: p.fee_rate,
    promptpayId: p.config?.promptpay_id,
    requiresReference: p.requires_reference,
    settlementDays: p.settlement_days,
  }));

  const suppliers: Supplier[] = shop.suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    phone: s.phone ?? undefined,
    lineId: s.line_id ?? undefined,
    paymentTermsDays: s.payment_terms_days,
    leadTimeDays: s.lead_time_days,
  }));

  // How each ingredient is usually bought (the preferred supplier's pack, else the first one listed) —
  // the receiving and purchasing pages read this to pre-fill packs and group by supplier.
  const supplierItems = new Map<string, { supplierId: string; item: ShopApiResponse["suppliers"][number]["items"][number] }[]>();
  for (const s of shop.suppliers)
    for (const item of s.items) supplierItems.set(item.ingredientId, [...(supplierItems.get(item.ingredientId) ?? []), { supplierId: s.id, item }]);

  const ingredients: Ingredient[] = shop.ingredients.map((i, idx) => {
    // Unlike prices, per-unit costs are ฿ (not satang) as decimals, exactly as the demo engine and @sabai/domain costing use them.
    const standardCost = i.standard_cost ?? 0;
    const candidates = supplierItems.get(i.id) ?? [];
    const chosen = candidates.find((c) => c.item.isPreferred) ?? candidates[0];
    let pack: Ingredient["pack"];
    if (chosen) {
      const lastPrice = chosen.item.lastPrice ? toSatang(chosen.item.lastPrice) : 0;
      // Never bought yet: estimate from the standard cost so the receiving form isn't pre-filled with ฿0.
      pack = {
        name: chosen.item.packName,
        qty: chosen.item.packQty,
        price: lastPrice > 0 ? lastPrice : Math.round(standardCost * chosen.item.packQty * 100),
        supplierId: chosen.supplierId,
      };
    }
    return {
      id: i.id,
      name: i.name,
      emoji: guessEmoji(i.name, "🥘"),
      baseUnit: i.base_unit,
      displayUnit: i.display_unit ?? undefined,
      kind: i.kind,
      trackStock: i.track_stock,
      category: i.category ?? "",
      reorderPoint: i.reorder_point ?? undefined,
      parLevel: i.par_level ?? undefined,
      standardCost,
      lastCost: i.last_cost ?? undefined,
      zone: i.storage_zone ?? undefined,
      countSort: idx,
      pack,
    };
  });

  const menuCategories: MenuCategory[] = shop.menuCategories.map((c) => ({ id: c.id, name: c.name, emoji: guessEmoji(c.name), color: c.color ?? "gray", sort: c.sort }));

  const menuItems: MenuItem[] = shop.menuItems.map((m) => ({
    id: m.id,
    categoryId: m.category_id,
    name: m.name,
    nameEn: m.name_en ?? undefined,
    emoji: guessEmoji(m.name),
    price: toSatang(m.price),
    route: m.kitchen_route,
    modifierGroupIds: m.modifierGroupIds,
    recipe: m.recipe.length ? { yieldQty: 1, lines: m.recipe.map((l) => ({ ingredientId: l.ingredientId, qty: l.qty, wasteRate: l.wasteRate })) } : undefined,
    active: m.is_active,
    soldOut: {},
    weight: 1,
    tags: m.tags.length ? m.tags : undefined,
  }));

  const modifierGroups: ModifierGroup[] = shop.modifierGroups.map((g) => ({
    id: g.id,
    name: g.name,
    min: g.min_select,
    max: g.max_select,
    options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: toSatang(o.price_delta) })),
  }));

  const roles: Role[] = shop.roles.map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description ?? "",
    grantsAll: r.grants_all,
    home: r.home,
    color: r.color ?? "gray",
    // The API marks grants-all roles with "*"; the client models that with grantsAll alone (accessFromRole).
    permissions: r.permissions.filter((p) => p !== "*"),
  }));

  // The API never returns PIN values (hashed, write-only) — unlike the demo,
  // which shows them for the sample shop. Pages that display a member's PIN
  // (e.g. a "switch user" screen listing everyone's code) only make sense in
  // demo mode; in API mode staff enter their own PIN, they don't look it up.
  const members: Member[] = shop.members.map((m) => ({
    id: m.id,
    name: m.display_name,
    nickname: m.nickname ?? undefined,
    roleKey: m.role_key,
    pin: "",
    branchIds: m.all_branches ? "all" : (m.branch_ids ?? []),
    maxDiscountRate: m.max_discount_rate,
    color: "slate",
    active: m.status === "active",
  }));

  return { tenant, branches, stations, channels, paymentMethods, suppliers, ingredients, menuCategories, menuItems, modifierGroups, roles, members };
}
