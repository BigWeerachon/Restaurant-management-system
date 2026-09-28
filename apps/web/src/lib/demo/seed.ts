import { ROLE_TEMPLATES, type Recipe } from "@sabai/domain";
import type {
  Branch,
  Channel,
  DemoState,
  Ingredient,
  MenuCategory,
  MenuItem,
  ModifierGroup,
  PaymentMethod,
  Role,
  Station,
  Supplier,
  Tenant,
} from "./types";

export const DEMO_VERSION = 9;

const baht = (n: number) => Math.round(n * 100);

// ---------------------------------------------------------------------------
// Shared building blocks (used by both the sample shop and a fresh shop)
// ---------------------------------------------------------------------------
export function defaultRoles(): Role[] {
  return ROLE_TEMPLATES.map((r) => ({
    key: r.key,
    name: r.th,
    description: r.description,
    grantsAll: r.grantsAll,
    home: r.home,
    color: r.color,
    permissions: [...r.permissions],
  }));
}

export function defaultChannels(): Channel[] {
  return [
    { id: "ch-dine", key: "dine_in", kind: "dine_in", name: "ทานที่ร้าน", short: "ทานที่ร้าน", color: "#13784f", active: true, commissionRate: 0, priceMarkup: 0, appliesServiceCharge: true, settlementDays: 0 },
    { id: "ch-take", key: "takeaway", kind: "takeaway", name: "กลับบ้าน", short: "กลับบ้าน", color: "#2a78d6", active: true, commissionRate: 0, priceMarkup: 0, appliesServiceCharge: false, settlementDays: 0 },
    { id: "ch-grab", key: "grabfood", kind: "delivery_platform", name: "GrabFood", short: "Grab", color: "#00a650", active: true, commissionRate: 0.3, priceMarkup: 0.15, appliesServiceCharge: false, settlementDays: 7 },
    { id: "ch-lineman", key: "lineman", kind: "delivery_platform", name: "LINE MAN", short: "LINE MAN", color: "#06c755", active: true, commissionRate: 0.3, priceMarkup: 0.15, appliesServiceCharge: false, settlementDays: 7 },
    { id: "ch-shopee", key: "shopeefood", kind: "delivery_platform", name: "ShopeeFood", short: "Shopee", color: "#ee4d2d", active: false, commissionRate: 0.3, priceMarkup: 0.15, appliesServiceCharge: false, settlementDays: 7 },
  ];
}

export function defaultPaymentMethods(active: { promptpay: boolean; card: boolean }): PaymentMethod[] {
  return [
    { id: "pm-cash", kind: "cash", name: "เงินสด", active: true, feeRate: 0, requiresReference: false, settlementDays: 0 },
    { id: "pm-pp", kind: "promptpay", name: "พร้อมเพย์ (QR)", active: active.promptpay, feeRate: 0, promptpayId: active.promptpay ? "0812345678" : undefined, requiresReference: false, settlementDays: 0 },
    { id: "pm-card", kind: "card", name: "บัตรเครดิต/เดบิต", active: active.card, feeRate: 0.02, requiresReference: true, settlementDays: 2 },
    { id: "pm-platform", kind: "platform", name: "ชำระผ่านแพลตฟอร์ม", active: true, feeRate: 0, requiresReference: false, settlementDays: 7 },
  ];
}

export function defaultStations(branchId: string): Station[] {
  return [
    { id: `st-${branchId}-kitchen`, branchId, name: "ครัว", route: "kitchen", warnAfterSec: 480, lateAfterSec: 900 },
    { id: `st-${branchId}-bar`, branchId, name: "บาร์เครื่องดื่ม", route: "bar", warnAfterSec: 240, lateAfterSec: 480 },
  ];
}

// ---------------------------------------------------------------------------
// Sample shop: "สบายดี คาเฟ่ & ครัว"
// ---------------------------------------------------------------------------
const suppliers: Supplier[] = [
  { id: "sup-roaster", name: "โรงคั่วดอยสะเก็ด", phone: "053-123-456", lineId: "@doisaket", paymentTermsDays: 30, leadTimeDays: 2 },
  { id: "sup-dairy", name: "แดรี่โฮม ขอนแก่น", phone: "043-555-010", lineId: "@dairyhome", paymentTermsDays: 15, leadTimeDays: 1 },
  { id: "sup-makro", name: "แม็คโคร (ซื้อเงินสด)", paymentTermsDays: 0, leadTimeDays: 0 },
  { id: "sup-market", name: "ตลาดอ.ต.ก.", paymentTermsDays: 0, leadTimeDays: 0 },
  { id: "sup-bakery", name: "บ้านขนมอบ", phone: "02-111-2233", lineId: "@banbake", paymentTermsDays: 7, leadTimeDays: 1 },
];

type IngSpec = [id: string, name: string, emoji: string, base: "g" | "ml" | "pcs", display: string | undefined, category: string, zone: string, pack: [name: string, qty: number, price: number, supplier: string], reorder?: number, par?: number, extra?: Partial<Ingredient>];

const ING: IngSpec[] = [
  ["coffee", "เมล็ดกาแฟคั่วกลาง", "☕", "g", "kg", "บาร์", "ชั้นบาร์ 1", ["ถุง 1 กก.", 1000, 520, "sup-roaster"], 1500, 5000, { highValue: true }],
  ["milk", "นมสด", "🥛", "ml", "l", "นมและเครื่องดื่ม", "ตู้เย็นบาร์", ["ขวด 2 ลิตร", 2000, 96, "sup-dairy"], 6000, 16000],
  ["oat", "นมโอ๊ต", "🌾", "ml", "l", "นมและเครื่องดื่ม", "ตู้เย็นบาร์", ["กล่อง 1 ลิตร", 1000, 110, "sup-makro"], 2000, 6000],
  ["condensed", "นมข้นหวาน", "🥫", "g", undefined, "นมและเครื่องดื่ม", "ชั้นบาร์ 2", ["กระป๋อง 388 ก.", 388, 35, "sup-makro"], 800, 3000],
  ["thaitea", "ผงชาไทย", "🍂", "g", "kg", "บาร์", "ชั้นบาร์ 2", ["ถุง 400 ก.", 400, 160, "sup-makro"], 400, 1600],
  ["matcha", "ผงมัทฉะ", "🍵", "g", undefined, "บาร์", "ชั้นบาร์ 1", ["ถุง 100 ก.", 100, 160, "sup-roaster"], 150, 500, { highValue: true }],
  ["cocoa", "ผงโกโก้", "🍫", "g", "kg", "บาร์", "ชั้นบาร์ 2", ["ถุง 500 ก.", 500, 175, "sup-makro"], 500, 2000],
  ["sugar", "น้ำตาลทราย", "🧂", "g", "kg", "ของแห้งและเครื่องปรุง", "ชั้นของแห้ง", ["ถุง 1 กก.", 1000, 28, "sup-makro"], 2000, 6000],
  ["caramel", "ไซรัปคาราเมล", "🍯", "ml", undefined, "บาร์", "ชั้นบาร์ 2", ["ขวด 750 มล.", 750, 340, "sup-makro"], 500, 1500],
  ["whip", "วิปปิ้งครีม", "🍦", "ml", undefined, "นมและเครื่องดื่ม", "ตู้เย็นบาร์", ["กล่อง 1 ลิตร", 1000, 250, "sup-makro"], 500, 2000],
  ["ice", "น้ำแข็ง", "🧊", "g", "kg", "นมและเครื่องดื่ม", "ถังน้ำแข็ง", ["กระสอบ 20 กก.", 20000, 80, "sup-market"], 20000, 60000],
  ["cup", "แก้ว 16 ออนซ์", "🥤", "pcs", undefined, "บรรจุภัณฑ์", "ชั้นบรรจุภัณฑ์", ["แพ็ก 50 ใบ", 50, 90, "sup-makro"], 150, 600, { kind: "packaging" }],
  ["lid", "ฝาโดม", "🔘", "pcs", undefined, "บรรจุภัณฑ์", "ชั้นบรรจุภัณฑ์", ["แพ็ก 50 ใบ", 50, 45, "sup-makro"], 150, 600, { kind: "packaging" }],
  ["box", "กล่องอาหาร", "📦", "pcs", undefined, "บรรจุภัณฑ์", "ชั้นบรรจุภัณฑ์", ["แพ็ก 25 ใบ", 25, 80, "sup-makro"], 60, 300, { kind: "packaging" }],
  ["rice", "ข้าวหอมมะลิ", "🍚", "g", "kg", "ของแห้งและเครื่องปรุง", "ชั้นของแห้ง", ["ถุง 5 กก.", 5000, 175, "sup-makro"], 5000, 20000],
  ["chicken", "อกไก่", "🍗", "g", "kg", "เนื้อสัตว์", "ตู้แช่ครัว", ["แพ็ก 1 กก.", 1000, 120, "sup-market"], 2000, 6000],
  ["pork", "หมูสับ", "🥩", "g", "kg", "เนื้อสัตว์", "ตู้แช่ครัว", ["แพ็ก 1 กก.", 1000, 140, "sup-market"], 1500, 5000],
  ["shrimp", "กุ้งขาว", "🦐", "g", "kg", "เนื้อสัตว์", "ตู้แช่ครัว", ["แพ็ก 1 กก.", 1000, 380, "sup-market"], 1000, 3000, { highValue: true }],
  ["egg", "ไข่ไก่", "🥚", "pcs", undefined, "เนื้อสัตว์", "ตู้เย็นครัว", ["แผง 30 ฟอง", 30, 126, "sup-market"], 60, 180],
  ["basil", "ใบกะเพรา", "🌿", "g", undefined, "ผักและผลไม้", "ตู้เย็นครัว", ["กำ 500 ก.", 500, 100, "sup-market"], 300, 1000],
  ["garlic", "กระเทียม", "🧄", "g", "kg", "ผักและผลไม้", "ชั้นครัว", ["ถุง 1 กก.", 1000, 90, "sup-market"], 500, 2000],
  ["chili", "พริกขี้หนู", "🌶️", "g", undefined, "ผักและผลไม้", "ตู้เย็นครัว", ["ถุง 500 ก.", 500, 75, "sup-market"], 200, 800],
  ["kale", "คะน้า", "🥬", "g", "kg", "ผักและผลไม้", "ตู้เย็นครัว", ["มัด 1 กก.", 1000, 60, "sup-market"], 1000, 3000],
  ["noodle", "เส้นใหญ่", "🍜", "g", "kg", "ของแห้งและเครื่องปรุง", "ตู้เย็นครัว", ["ถุง 1 กก.", 1000, 60, "sup-market"], 2000, 6000],
  ["soy", "ซีอิ๊วขาว", "🫙", "ml", "l", "ของแห้งและเครื่องปรุง", "ชั้นครัว", ["ขวด 700 มล.", 700, 38, "sup-makro"], 1000, 4000],
  ["oyster", "ซอสหอยนางรม", "🦪", "ml", "l", "ของแห้งและเครื่องปรุง", "ชั้นครัว", ["ขวด 600 มล.", 600, 45, "sup-makro"], 1000, 3000],
  ["oil", "น้ำมันพืช", "🛢️", "ml", "l", "ของแห้งและเครื่องปรุง", "ชั้นครัว", ["ขวด 1 ลิตร", 1000, 50, "sup-makro"], 2000, 6000],
  ["bread", "ขนมปังโชกุปัง", "🍞", "pcs", undefined, "เบเกอรี่", "ชั้นเบเกอรี่", ["แถว 10 แผ่น", 10, 35, "sup-bakery"], 20, 60],
  ["butter", "เนยสด", "🧈", "g", undefined, "นมและเครื่องดื่ม", "ตู้เย็นครัว", ["ก้อน 227 ก.", 227, 95, "sup-makro"], 400, 1500],
  ["cake", "เค้กช็อกโกแลต (ชิ้น)", "🍰", "pcs", undefined, "เบเกอรี่", "ตู้โชว์เค้ก", ["ถาด 8 ชิ้น", 8, 224, "sup-bakery"], 6, 16, { kind: "merchandise" }],
  ["croissant", "ครัวซองต์", "🥐", "pcs", undefined, "เบเกอรี่", "ตู้โชว์เค้ก", ["ถาด 10 ชิ้น", 10, 220, "sup-bakery"], 6, 20, { kind: "merchandise" }],
];

function buildIngredients(): Ingredient[] {
  return ING.map(([id, name, emoji, base, display, category, zone, [packName, packQty, packPrice, supplierId], reorder, par, extra], i) => ({
    id: `ing-${id}`,
    name,
    emoji,
    baseUnit: base,
    displayUnit: display,
    kind: "raw",
    trackStock: true,
    category,
    zone,
    countSort: i,
    reorderPoint: reorder,
    parLevel: par,
    standardCost: Math.round((packPrice / packQty) * 1_000_000) / 1_000_000,
    lastCost: Math.round((packPrice / packQty) * 1_000_000) / 1_000_000,
    pack: { name: packName, qty: packQty, price: baht(packPrice), supplierId },
    ...extra,
  }));
}

/** Untracked preps: made in small batches, exploded to raw ingredients at sale. */
function prepIngredients(): { ingredients: Ingredient[]; recipes: Record<string, Recipe> } {
  return {
    ingredients: [
      { id: "ing-syrup", name: "น้ำเชื่อม (ทำเอง)", emoji: "💧", baseUnit: "ml", kind: "prep", trackStock: false, category: "ของเตรียม", countSort: 90, standardCost: 0 },
      { id: "ing-sauce", name: "ซอสผัดสูตรร้าน", emoji: "🥣", baseUnit: "ml", kind: "prep", trackStock: false, category: "ของเตรียม", countSort: 91, standardCost: 0 },
    ],
    recipes: {
      "ing-syrup": { yieldQty: 1000, lines: [{ ingredientId: "ing-sugar", qty: 600 }] },
      "ing-sauce": {
        yieldQty: 1000,
        lines: [
          { ingredientId: "ing-soy", qty: 400 },
          { ingredientId: "ing-oyster", qty: 400 },
          { ingredientId: "ing-sugar", qty: 150 },
        ],
      },
    },
  };
}

const r = (lines: Array<[string, number, number?]>, yieldQty = 1): Recipe => ({
  yieldQty,
  lines: lines.map(([id, qty, wasteRate]) => ({ ingredientId: `ing-${id}`, qty, wasteRate: wasteRate ?? 0 })),
});

const ICED_CUP: Array<[string, number]> = [["ice", 150], ["cup", 1], ["lid", 1]];

const menuCategories: MenuCategory[] = [
  { id: "cat-coffee", name: "กาแฟ", emoji: "☕", color: "#8a5a3b", sort: 1 },
  { id: "cat-tea", name: "ชา นม โกโก้", emoji: "🧋", color: "#c0772e", sort: 2 },
  { id: "cat-food", name: "อาหารจานเดียว", emoji: "🍛", color: "#c2410c", sort: 3 },
  { id: "cat-bakery", name: "ขนมและเบเกอรี่", emoji: "🥐", color: "#b45309", sort: 4 },
];

const modifierGroups: ModifierGroup[] = [
  {
    id: "mg-sweet",
    name: "ความหวาน",
    min: 1,
    max: 1,
    options: [
      { id: "mo-sweet-normal", name: "หวานปกติ", priceDelta: 0 },
      { id: "mo-sweet-less", name: "หวานน้อย", priceDelta: 0, recipe: r([["syrup", -10]]) },
      { id: "mo-sweet-none", name: "ไม่หวาน", priceDelta: 0, recipe: r([["syrup", -20]]) },
    ],
  },
  { id: "mg-milk", name: "เปลี่ยนนม", min: 0, max: 1, options: [{ id: "mo-oat", name: "นมโอ๊ต", priceDelta: baht(20), recipe: r([["milk", -180], ["oat", 180]]) }] },
  {
    id: "mg-extra",
    name: "เพิ่มพิเศษ",
    min: 0,
    max: 2,
    options: [
      { id: "mo-shot", name: "เพิ่มช็อต", priceDelta: baht(15), recipe: r([["coffee", 18]]) },
      { id: "mo-whip", name: "วิปครีม", priceDelta: baht(10), recipe: r([["whip", 30]]) },
    ],
  },
  { id: "mg-egg", name: "ไข่", min: 0, max: 1, options: [{ id: "mo-egg", name: "เพิ่มไข่ดาว", priceDelta: baht(10), recipe: r([["egg", 1], ["oil", 10]]) }] },
  {
    id: "mg-spicy",
    name: "ความเผ็ด",
    min: 0,
    max: 1,
    options: [
      { id: "mo-spicy-less", name: "เผ็ดน้อย", priceDelta: 0 },
      { id: "mo-spicy-more", name: "เผ็ดมาก", priceDelta: 0, recipe: r([["chili", 5]]) },
    ],
  },
];

type MenuSpec = [id: string, cat: string, name: string, emoji: string, price: number, route: string, groups: string[], recipe: Recipe, weight: number, tags?: string[]];

const MENU: MenuSpec[] = [
  ["espresso", "cat-coffee", "เอสเปรสโซ่", "☕", 55, "bar", ["mg-extra"], r([["coffee", 18]]), 3],
  ["americano", "cat-coffee", "อเมริกาโน่เย็น", "🧊", 60, "bar", ["mg-sweet", "mg-extra"], r([["coffee", 18], ["syrup", 10], ...ICED_CUP]), 12],
  ["latte", "cat-coffee", "ลาเต้เย็น", "🥛", 70, "bar", ["mg-sweet", "mg-milk", "mg-extra"], r([["coffee", 18], ["milk", 180], ["syrup", 20], ...ICED_CUP]), 16, ["ขายดี"]],
  ["cappuccino", "cat-coffee", "คาปูชิโน่ร้อน", "☕", 65, "bar", ["mg-sweet", "mg-milk", "mg-extra"], r([["coffee", 18], ["milk", 150], ["syrup", 10]]), 6],
  ["mocha", "cat-coffee", "มอคค่าเย็น", "🍫", 80, "bar", ["mg-sweet", "mg-milk", "mg-extra"], r([["coffee", 18], ["milk", 160], ["cocoa", 15], ["syrup", 15], ...ICED_CUP]), 7],
  ["caramel", "cat-coffee", "คาราเมลมัคคิอาโต้", "🍮", 85, "bar", ["mg-milk", "mg-extra"], r([["coffee", 18], ["milk", 180], ["caramel", 25], ...ICED_CUP]), 6],
  ["thaitea", "cat-tea", "ชาไทยเย็น", "🧡", 55, "bar", ["mg-sweet"], r([["thaitea", 25], ["milk", 120], ["condensed", 30], ["syrup", 20], ...ICED_CUP]), 14, ["ขายดี"]],
  ["matcha", "cat-tea", "มัทฉะลาเต้", "🍵", 85, "bar", ["mg-sweet", "mg-milk"], r([["matcha", 5], ["milk", 180], ["syrup", 15], ...ICED_CUP]), 9],
  ["cocoa", "cat-tea", "โกโก้เย็น", "🍫", 60, "bar", ["mg-sweet", "mg-milk", "mg-extra"], r([["cocoa", 25], ["milk", 180], ["syrup", 20], ...ICED_CUP]), 7],
  ["caramelmilk", "cat-tea", "นมสดคาราเมล", "🥛", 65, "bar", ["mg-sweet", "mg-extra"], r([["milk", 200], ["caramel", 25], ...ICED_CUP]), 4],
  ["kaprao-chicken", "cat-food", "ข้าวกะเพราไก่", "🍛", 75, "kitchen", ["mg-egg", "mg-spicy"], r([["rice", 80], ["chicken", 120, 0.08], ["basil", 10], ["garlic", 6], ["chili", 5], ["sauce", 25], ["oil", 15]]), 13, ["ขายดี"]],
  ["kaprao-pork", "cat-food", "ข้าวกะเพราหมูสับ", "🍛", 75, "kitchen", ["mg-egg", "mg-spicy"], r([["rice", 80], ["pork", 110], ["basil", 10], ["garlic", 6], ["chili", 5], ["sauce", 25], ["oil", 15]]), 10],
  ["friedrice-shrimp", "cat-food", "ข้าวผัดกุ้ง", "🍤", 95, "kitchen", ["mg-egg"], r([["rice", 90], ["shrimp", 80, 0.15], ["egg", 1], ["garlic", 5], ["sauce", 15], ["oil", 15]]), 7],
  ["padsee-ew", "cat-food", "ผัดซีอิ๊วหมู", "🍜", 75, "kitchen", ["mg-egg"], r([["noodle", 180], ["pork", 90], ["kale", 50, 0.1], ["egg", 1], ["soy", 20], ["sauce", 10], ["oil", 15]]), 6],
  ["omelette-rice", "cat-food", "ข้าวไข่เจียว", "🍳", 45, "kitchen", ["mg-spicy"], r([["rice", 80], ["egg", 2], ["oil", 30]]), 6],
  ["friedrice-chicken", "cat-food", "ข้าวผัดไก่", "🍚", 70, "kitchen", ["mg-egg"], r([["rice", 90], ["chicken", 90, 0.08], ["egg", 1], ["garlic", 5], ["sauce", 15], ["oil", 15]]), 5],
  ["cake", "cat-bakery", "เค้กช็อกโกแลต", "🍰", 95, "bar", [], r([["cake", 1]]), 5],
  ["croissant", "cat-bakery", "ครัวซองต์เนยสด", "🥐", 75, "bar", [], r([["croissant", 1]]), 6],
  ["honeytoast", "cat-bakery", "ฮันนี่โทสต์", "🍯", 129, "kitchen", [], r([["bread", 4], ["butter", 30], ["whip", 50], ["caramel", 20]]), 3, ["ใหม่"]],
];

function buildMenu(): MenuItem[] {
  return MENU.map(([id, cat, name, emoji, price, route, groups, recipe, weight, tags]) => ({
    id: `mi-${id}`,
    categoryId: cat,
    name,
    emoji,
    price: baht(price),
    route,
    modifierGroupIds: groups,
    recipe,
    active: true,
    soldOut: {},
    weight,
    tags,
  }));
}

function sampleTenant(): Tenant {
  return {
    name: "สบายดี คาเฟ่ & ครัว",
    businessType: "cafe",
    vatRegistered: true,
    pricesIncludeVat: true,
    vatRate: 0.07,
    cashRounding: "none",
    plan: "business",
    trialEndsAt: "2026-10-11",
    onboarding: { skipped: [], paymentsConfirmed: true },
  };
}

function sampleBranches(): Branch[] {
  const tables = (prefix: string, n: number, zone: string, seats: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix}${i + 1}`, seats, zone }));
  return [
    {
      id: "br-ari",
      code: "ARI",
      name: "สาขาอารีย์",
      address: "88 ซอยอารีย์ 1 แขวงสามเสนใน เขตพญาไท กรุงเทพฯ 10400",
      phone: "02-123-4567",
      openingHours: "07:00–20:00",
      dayCutoff: "05:00",
      serviceChargeRate: 0,
      tables: [...tables("A", 8, "ในร้าน", 2).map((t) => ({ ...t, id: `ari-${t.id}` })), ...tables("B", 4, "ระเบียง", 4).map((t) => ({ ...t, id: `ari-${t.id}` }))],
    },
    {
      id: "br-tl",
      code: "TL",
      name: "สาขาทองหล่อ",
      address: "55 ทองหล่อ 13 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110",
      phone: "02-765-4321",
      openingHours: "08:00–22:00",
      dayCutoff: "05:00",
      serviceChargeRate: 0,
      tables: [...tables("T", 10, "ในร้าน", 2).map((t) => ({ ...t, id: `tl-${t.id}` })), ...tables("V", 4, "โซน VIP", 6).map((t) => ({ ...t, id: `tl-${t.id}` }))],
    },
  ];
}

/** Starting stock: a few items deliberately low/out so alerts have something to say. */
const STOCK_LEVELS: Record<string, [ari: number, tl: number]> = {
  coffee: [3800, 1200],
  milk: [14000, 9000],
  oat: [1500, 4200],
  condensed: [2300, 1800],
  thaitea: [1100, 700],
  matcha: [120, 380],
  cocoa: [1300, 900],
  sugar: [4200, 3000],
  caramel: [1100, 400],
  whip: [1200, 800],
  ice: [42000, 38000],
  cup: [420, 260],
  lid: [410, 90],
  box: [180, 140],
  rice: [14000, 11000],
  chicken: [4100, 2600],
  pork: [3000, 1100],
  shrimp: [1800, 0],
  egg: [120, 75],
  basil: [650, 280],
  garlic: [1500, 900],
  chili: [480, 350],
  kale: [2100, 1400],
  noodle: [4200, 2500],
  soy: [2600, 1900],
  oyster: [2200, 1500],
  oil: [4800, 3100],
  bread: [34, 18],
  butter: [900, 500],
  cake: [9, 5],
  croissant: [12, 7],
};

export function members() {
  return [
    { id: "m-owner", name: "คุณปิยะ", roleKey: "owner", pin: "1234", branchIds: "all" as const, color: "violet", active: true },
    { id: "m-manager", name: "พี่นิด", roleKey: "manager", pin: "2222", branchIds: "all" as const, color: "indigo", active: true },
    { id: "m-cashier", name: "น้องแพรว", roleKey: "cashier", pin: "3333", branchIds: ["br-ari"], maxDiscountRate: 0.1, color: "emerald", active: true },
    { id: "m-waiter", name: "น้องโอ๊ต", roleKey: "waiter", pin: "4444", branchIds: ["br-ari"], color: "sky", active: true },
    { id: "m-kitchen", name: "ป้าแดง", roleKey: "kitchen", pin: "5555", branchIds: ["br-ari"], color: "orange", active: true },
    { id: "m-stock", name: "พี่ต้น", roleKey: "stock", pin: "6666", branchIds: "all" as const, color: "amber", active: true },
    { id: "m-accountant", name: "คุณมิ้นท์", roleKey: "accountant", pin: "7777", branchIds: "all" as const, color: "rose", active: true },
  ];
}

export function sampleState(today: string): DemoState {
  const branches = sampleBranches();
  const raw = buildIngredients();
  const prep = prepIngredients();
  const balances: DemoState["balances"] = {};
  const movements: DemoState["movements"] = [];
  for (const ing of raw) {
    const key = ing.id.replace("ing-", "");
    const levels = STOCK_LEVELS[key] ?? [0, 0];
    branches.forEach((b, i) => {
      const qty = levels[i] ?? 0;
      balances[`${b.id}:${ing.id}`] = { qty, avgCost: ing.standardCost };
      if (qty > 0) {
        movements.push({
          id: `mv-open-${b.id}-${ing.id}`,
          branchId: b.id,
          ingredientId: ing.id,
          qty,
          unitCost: ing.standardCost,
          reason: "opening",
          at: `${today}T00:00:00.000Z`,
          businessDate: today,
        });
      }
    });
  }

  return {
    version: DEMO_VERSION,
    seededFor: today,
    mode: "demo",
    tenant: sampleTenant(),
    branches,
    stations: branches.flatMap((b) => defaultStations(b.id)),
    channels: defaultChannels(),
    paymentMethods: defaultPaymentMethods({ promptpay: true, card: true }),
    suppliers,
    ingredients: [...raw, ...prep.ingredients],
    prepRecipes: prep.recipes,
    menuCategories,
    menuItems: buildMenu(),
    modifierGroups,
    roles: defaultRoles(),
    members: members(),
    balances,
    movements,
    orders: [],
    tickets: [],
    shifts: [],
    counts: [],
    purchaseOrders: [],
    receipts: [],
    dayCloses: [],
    expenses: [],
    bills: [],
    expected: [],
    statementLines: [],
    activity: [],
    seq: {},
  };
}

/** A brand-new shop: only what signup creates. Everything else is an empty state. */
export function freshState(today: string, shopName = "ร้านใหม่ของฉัน"): DemoState {
  const branch: Branch = { id: "br-main", code: "HQ", name: "สาขาหลัก", dayCutoff: "05:00", serviceChargeRate: 0, tables: [] };
  return {
    version: DEMO_VERSION,
    seededFor: today,
    mode: "fresh",
    tenant: {
      name: shopName,
      businessType: "restaurant",
      vatRegistered: false,
      pricesIncludeVat: true,
      vatRate: 0.07,
      cashRounding: "none",
      plan: "pro",
      trialEndsAt: "2026-10-11",
      onboarding: { skipped: [], paymentsConfirmed: false },
    },
    branches: [branch],
    stations: defaultStations(branch.id),
    channels: defaultChannels().map((c) => ({ ...c, active: c.kind === "dine_in" || c.kind === "takeaway" })),
    paymentMethods: defaultPaymentMethods({ promptpay: false, card: false }),
    suppliers: [],
    ingredients: [],
    prepRecipes: {},
    menuCategories: [],
    menuItems: [],
    modifierGroups: [],
    roles: defaultRoles(),
    members: [{ id: "m-owner", name: "คุณเจ้าของ", roleKey: "owner", pin: "1234", branchIds: "all", color: "violet", active: true }],
    balances: {},
    movements: [],
    orders: [],
    tickets: [],
    shifts: [],
    counts: [],
    purchaseOrders: [],
    receipts: [],
    dayCloses: [],
    expenses: [],
    bills: [],
    expected: [],
    statementLines: [],
    activity: [],
    seq: {},
  };
}
