/**
 * SaaS plans as the UI shows them. The database (app.plans) is the authority
 * for enforcement; test/plans.test.ts fails if the two drift apart.
 */
export type PlanCode = "free" | "starter" | "pro" | "business" | "enterprise";

export type Feature =
  | "pos" | "kds" | "inventory_basic" | "inventory" | "recipes" | "purchasing" | "finance" | "reconciliation"
  | "reports_basic" | "reports_profit" | "multi_branch" | "central_kitchen" | "analytics_advanced" | "api_access" | "ai_copilot" | "sso";

export interface Plan {
  code: PlanCode;
  name: string;
  nameEn: string;
  /** Baht per month; null = talk to sales. */
  priceMonthly: number | null;
  priceYearly: number | null;
  limits: { branches: number | null; staff: number | null; devices: number | null };
  features: readonly Feature[];
  pitch: string;
}

const BASE: Feature[] = ["pos", "kds", "inventory_basic", "reports_basic"];
const STARTER: Feature[] = [...BASE, "inventory", "recipes"];
const PRO: Feature[] = [...STARTER, "purchasing", "finance", "reconciliation", "reports_profit", "multi_branch"];
const BUSINESS: Feature[] = [...PRO, "central_kitchen", "analytics_advanced", "api_access"];

export const PLANS: readonly Plan[] = [
  { code: "free", name: "เริ่มต้นฟรี", nameEn: "Free", priceMonthly: 0, priceYearly: 0, limits: { branches: 1, staff: 3, devices: 1 }, features: BASE, pitch: "ขายหน้าร้านและจอครัวสำหรับร้านเล็ก" },
  { code: "starter", name: "สตาร์ทเตอร์", nameEn: "Starter", priceMonthly: 590, priceYearly: 5900, limits: { branches: 1, staff: 10, devices: 3 }, features: STARTER, pitch: "สต็อกและสูตร ตัดวัตถุดิบอัตโนมัติ" },
  { code: "pro", name: "โปร", nameEn: "Pro", priceMonthly: 1490, priceYearly: 14900, limits: { branches: 3, staff: 30, devices: 10 }, features: PRO, pitch: "รู้เงินเหลือจริง สั่งซื้อ กระทบยอด หลายสาขา" },
  { code: "business", name: "บิสิเนส", nameEn: "Business", priceMonthly: 3490, priceYearly: 34900, limits: { branches: 10, staff: 150, devices: 40 }, features: BUSINESS, pitch: "ครัวกลาง วิเคราะห์ขั้นสูง และ API" },
  { code: "enterprise", name: "เอนเตอร์ไพรส์", nameEn: "Enterprise", priceMonthly: null, priceYearly: null, limits: { branches: null, staff: null, devices: null }, features: [...BUSINESS, "ai_copilot", "sso"], pitch: "เครือร้านขนาดใหญ่ SSO และผู้ช่วย AI" },
];

export const FEATURE_COPY: Record<Feature, string> = {
  pos: "ขายหน้าร้าน (POS)",
  kds: "จอครัว",
  inventory_basic: "นับสต็อกพื้นฐาน",
  inventory: "สต็อกหลายคลัง ของเสีย โอนย้าย",
  recipes: "สูตรและต้นทุนต่อจาน",
  purchasing: "ใบสั่งซื้อและผู้ขาย",
  finance: "บิลค้างจ่าย ค่าใช้จ่าย ลงบัญชีให้อัตโนมัติ",
  reconciliation: "กระทบยอดธนาคารและแพลตฟอร์ม",
  reports_basic: "รายงานยอดขาย",
  reports_profit: "รายงานเงินเหลือจริง",
  multi_branch: "หลายสาขา",
  central_kitchen: "ครัวกลาง",
  analytics_advanced: "วิเคราะห์ขั้นสูง",
  api_access: "เชื่อมต่อ API",
  ai_copilot: "ผู้ช่วย AI",
  sso: "เข้าระบบด้วยบัญชีขององค์กร (SSO)",
};

export function planOf(code: string): Plan {
  return PLANS.find((p) => p.code === code) ?? PLANS[0]!;
}

export function planAllows(code: string, feature: Feature): boolean {
  return planOf(code).features.includes(feature);
}

/** null = unlimited. */
export function planLimit(code: string, metric: keyof Plan["limits"]): number | null {
  return planOf(code).limits[metric];
}

/** Cheapest plan that fits a need — used for "upgrade to …" hints. */
export function cheapestPlanFor(need: { feature?: Feature; branches?: number; staff?: number }): Plan {
  const fits = (p: Plan) =>
    (!need.feature || p.features.includes(need.feature)) &&
    (need.branches === undefined || p.limits.branches === null || p.limits.branches >= need.branches) &&
    (need.staff === undefined || p.limits.staff === null || p.limits.staff >= need.staff);
  return PLANS.find(fits) ?? PLANS[PLANS.length - 1]!;
}
