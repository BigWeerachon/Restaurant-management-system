/**
 * Permission catalog, role templates and role-based navigation.
 *
 * Source of truth for permission keys. The database seeds the same catalog
 * (supabase/migrations/…_bootstrap.sql); an API test fails if they drift.
 *
 * UX rule: people see only what their job needs. Navigation is derived from
 * permissions and ordered by what each role does most, with at most five
 * primary destinations (Hick's law) — everything else sits under "เพิ่มเติม".
 */
export const PERMISSIONS = [
  { key: "pos.order", module: "pos", th: "รับออเดอร์", en: "Take orders", risk: "low" },
  { key: "pos.pay", module: "pos", th: "รับชำระเงินและเปิด-ปิดกะ", en: "Take payments & run shifts", risk: "medium" },
  { key: "pos.discount", module: "pos", th: "ให้ส่วนลด", en: "Give discounts", risk: "medium" },
  { key: "pos.void", module: "pos", th: "ยกเลิกรายการที่ส่งครัวแล้ว", en: "Void items sent to kitchen", risk: "high" },
  { key: "pos.refund", module: "pos", th: "คืนเงินลูกค้า", en: "Refund customers", risk: "high" },
  { key: "pos.manage_shift", module: "pos", th: "นำเงินเข้า-ออกลิ้นชัก", en: "Cash in / cash out", risk: "medium" },
  { key: "kds.view", module: "kds", th: "ดูจอครัว", en: "View kitchen display", risk: "low" },
  { key: "kds.bump", module: "kds", th: "อัปเดตสถานะอาหาร", en: "Bump kitchen tickets", risk: "low" },
  { key: "menu.manage", module: "menu", th: "แก้ไขเมนูและราคา", en: "Manage menu & prices", risk: "medium" },
  { key: "menu.availability", module: "menu", th: "ปิด-เปิดเมนูที่ของหมด", en: "Mark items sold out", risk: "low" },
  { key: "recipes.view", module: "recipes", th: "ดูสูตรอาหาร", en: "View recipes", risk: "low" },
  { key: "recipes.manage", module: "recipes", th: "แก้ไขสูตรอาหาร", en: "Manage recipes", risk: "medium" },
  { key: "costs.view", module: "recipes", th: "ดูต้นทุนและกำไรต่อจาน", en: "View costs & margins", risk: "medium" },
  { key: "inventory.view", module: "inventory", th: "ดูสต็อก", en: "View stock", risk: "low" },
  { key: "inventory.manage", module: "inventory", th: "เพิ่ม-แก้ไขรายการวัตถุดิบ", en: "Manage ingredients", risk: "medium" },
  { key: "inventory.receive", module: "inventory", th: "รับของเข้า", en: "Receive goods", risk: "low" },
  { key: "inventory.count", module: "inventory", th: "นับสต็อก", en: "Count stock", risk: "low" },
  { key: "inventory.adjust", module: "inventory", th: "อนุมัติปรับยอดสต็อก", en: "Approve stock adjustments", risk: "high" },
  { key: "inventory.waste", module: "inventory", th: "บันทึกของเสีย", en: "Record waste", risk: "low" },
  { key: "inventory.transfer", module: "inventory", th: "โอนย้ายสต็อกระหว่างสาขา", en: "Transfer stock", risk: "medium" },
  { key: "inventory.produce", module: "inventory", th: "ผลิตของเตรียม", en: "Produce prep batches", risk: "low" },
  { key: "purchasing.view", module: "purchasing", th: "ดูใบสั่งซื้อและผู้ขาย", en: "View purchasing", risk: "low" },
  { key: "purchasing.manage", module: "purchasing", th: "สร้างใบสั่งซื้อและจัดการผู้ขาย", en: "Manage POs & suppliers", risk: "medium" },
  { key: "purchasing.approve", module: "purchasing", th: "อนุมัติใบสั่งซื้อ", en: "Approve purchase orders", risk: "high" },
  { key: "finance.view", module: "finance", th: "ดูข้อมูลการเงิน", en: "View finance", risk: "medium" },
  { key: "finance.manage", module: "finance", th: "บันทึกค่าใช้จ่ายและจ่ายบิล", en: "Expenses & bill payments", risk: "high" },
  { key: "finance.reconcile", module: "finance", th: "กระทบยอดธนาคารและแพลตฟอร์ม", en: "Reconcile bank & platforms", risk: "high" },
  { key: "finance.close_day", module: "finance", th: "ปิดยอดประจำวัน", en: "Close the business day", risk: "medium" },
  { key: "reports.sales", module: "reports", th: "ดูรายงานยอดขาย", en: "View sales reports", risk: "low" },
  { key: "reports.profit", module: "reports", th: "ดูรายงานกำไรและเงินเหลือจริง", en: "View profit reports", risk: "medium" },
  { key: "staff.manage", module: "admin", th: "จัดการพนักงานและสิทธิ์", en: "Manage staff & roles", risk: "high" },
  { key: "settings.manage", module: "admin", th: "ตั้งค่าร้านและสาขา", en: "Manage settings", risk: "high" },
  { key: "billing.manage", module: "admin", th: "จัดการแพ็กเกจและค่าบริการ", en: "Manage subscription", risk: "high" },
  { key: "audit.view", module: "admin", th: "ดูประวัติการใช้งาน", en: "View activity log", risk: "medium" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];
export type PermissionModule = (typeof PERMISSIONS)[number]["module"];
export type Risk = "low" | "medium" | "high";

export const PERMISSION_MODULES: Record<PermissionModule, { th: string; en: string }> = {
  pos: { th: "หน้าร้าน", en: "Front of house" },
  kds: { th: "ครัว", en: "Kitchen" },
  menu: { th: "เมนู", en: "Menu" },
  recipes: { th: "สูตรและต้นทุน", en: "Recipes & costs" },
  inventory: { th: "สต็อก", en: "Inventory" },
  purchasing: { th: "จัดซื้อ", en: "Purchasing" },
  finance: { th: "การเงิน", en: "Finance" },
  reports: { th: "รายงาน", en: "Reports" },
  admin: { th: "ผู้ดูแลระบบ", en: "Administration" },
};

export type RoleKey = "owner" | "manager" | "cashier" | "waiter" | "kitchen" | "stock" | "accountant";
export type Home = "today" | "pos" | "kds" | "inventory" | "finance" | "reports";

export interface RoleTemplate {
  key: RoleKey;
  th: string;
  en: string;
  description: string;
  grantsAll: boolean;
  home: Home;
  color: string;
  permissions: readonly Permission[];
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: "owner",
    th: "เจ้าของร้าน",
    en: "Owner",
    description: "เห็นและทำได้ทุกอย่าง",
    grantsAll: true,
    home: "today",
    color: "violet",
    permissions: PERMISSIONS.map((p) => p.key),
  },
  {
    key: "manager",
    th: "ผู้จัดการร้าน",
    en: "Manager",
    description: "ดูแลหน้าร้าน สต็อก ทีม และปิดยอด",
    grantsAll: false,
    home: "today",
    color: "indigo",
    permissions: [
      "pos.order", "pos.pay", "pos.discount", "pos.void", "pos.refund", "pos.manage_shift",
      "kds.view", "kds.bump", "menu.manage", "menu.availability", "recipes.view", "recipes.manage", "costs.view",
      "inventory.view", "inventory.manage", "inventory.receive", "inventory.count", "inventory.adjust",
      "inventory.waste", "inventory.transfer", "inventory.produce",
      "purchasing.view", "purchasing.manage", "purchasing.approve",
      "finance.close_day", "reports.sales", "reports.profit", "staff.manage", "audit.view",
    ],
  },
  {
    key: "cashier",
    th: "แคชเชียร์",
    en: "Cashier",
    description: "รับออเดอร์ รับเงิน เปิด-ปิดกะ",
    grantsAll: false,
    home: "pos",
    color: "emerald",
    permissions: ["pos.order", "pos.pay", "pos.discount", "pos.manage_shift", "kds.view", "menu.availability"],
  },
  {
    key: "waiter",
    th: "พนักงานเสิร์ฟ",
    en: "Waiter",
    description: "รับออเดอร์และส่งเข้าครัว",
    grantsAll: false,
    home: "pos",
    color: "sky",
    permissions: ["pos.order", "kds.view"],
  },
  {
    key: "kitchen",
    th: "ครัว",
    en: "Kitchen",
    description: "ดูออเดอร์ อัปเดตสถานะ บันทึกของเสีย",
    grantsAll: false,
    home: "kds",
    color: "orange",
    permissions: [
      "kds.view", "kds.bump", "menu.availability", "recipes.view", "inventory.view", "inventory.waste", "inventory.produce",
    ],
  },
  {
    key: "stock",
    th: "สต็อก/จัดซื้อ",
    en: "Stock & purchasing",
    description: "รับของ นับสต็อก สั่งซื้อ",
    grantsAll: false,
    home: "inventory",
    color: "amber",
    permissions: [
      "inventory.view", "inventory.manage", "inventory.receive", "inventory.count", "inventory.waste",
      "inventory.transfer", "inventory.produce", "recipes.view", "purchasing.view", "purchasing.manage",
    ],
  },
  {
    key: "accountant",
    th: "บัญชี",
    en: "Accountant",
    description: "ค่าใช้จ่าย จ่ายบิล กระทบยอด รายงาน",
    grantsAll: false,
    home: "finance",
    color: "rose",
    permissions: [
      "finance.view", "finance.manage", "finance.reconcile", "finance.close_day", "reports.sales", "reports.profit",
      "costs.view", "inventory.view", "purchasing.view", "audit.view",
    ],
  },
];

export function roleTemplate(key: RoleKey): RoleTemplate {
  const r = ROLE_TEMPLATES.find((t) => t.key === key);
  if (!r) throw new RangeError(`Unknown role ${key}`);
  return r;
}

/** Resolved access of one person inside one tenant. */
export interface Access {
  grantsAll: boolean;
  permissions: ReadonlySet<string>;
}

export function accessFromRole(role: Pick<RoleTemplate, "grantsAll" | "permissions">): Access {
  return { grantsAll: role.grantsAll, permissions: new Set(role.permissions) };
}

export function can(access: Access, permission: Permission): boolean {
  return access.grantsAll || access.permissions.has(permission);
}

export function canAny(access: Access, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(access, p));
}

// ---------------------------------------------------------------------------
// Task-based navigation
// ---------------------------------------------------------------------------
export type NavKey =
  | "today"
  | "pos"
  | "kds"
  | "orders"
  | "inventory"
  | "menu"
  | "purchasing"
  | "finance"
  | "reports"
  | "team"
  | "settings";

export interface NavItem {
  key: NavKey;
  href: string;
  th: string;
  en: string;
  icon: string;
  /** Visible when the person holds any of these. */
  anyOf: readonly Permission[];
  /** Full-screen work surfaces (POS, KDS) open without the back-office chrome. */
  fullscreen?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "today", href: "/today", th: "วันนี้", en: "Today", icon: "sun", anyOf: ["reports.sales", "finance.close_day", "staff.manage"] },
  { key: "pos", href: "/pos", th: "ขายหน้าร้าน", en: "Sell", icon: "store", anyOf: ["pos.order"], fullscreen: true },
  { key: "kds", href: "/kds", th: "จอครัว", en: "Kitchen", icon: "chef-hat", anyOf: ["kds.view"], fullscreen: true },
  { key: "orders", href: "/orders", th: "บิลวันนี้", en: "Orders", icon: "receipt", anyOf: ["pos.order", "pos.refund"] },
  { key: "inventory", href: "/inventory", th: "สต็อก", en: "Stock", icon: "package", anyOf: ["inventory.view"] },
  { key: "menu", href: "/menu", th: "เมนูและสูตร", en: "Menu & recipes", icon: "book-open", anyOf: ["menu.manage", "recipes.view"] },
  { key: "purchasing", href: "/purchasing", th: "สั่งซื้อ", en: "Purchasing", icon: "truck", anyOf: ["purchasing.view"] },
  { key: "finance", href: "/finance", th: "การเงิน", en: "Finance", icon: "wallet", anyOf: ["finance.view", "finance.close_day"] },
  { key: "reports", href: "/reports", th: "รายงาน", en: "Insights", icon: "chart", anyOf: ["reports.sales"] },
  { key: "team", href: "/team", th: "ทีมงาน", en: "Team", icon: "users", anyOf: ["staff.manage"] },
  { key: "settings", href: "/settings", th: "ตั้งค่า", en: "Settings", icon: "settings", anyOf: ["settings.manage", "billing.manage"] },
];

/** What each role reaches for first. Unknown/custom roles fall back to DEFAULT_ORDER. */
const ROLE_NAV_ORDER: Record<RoleKey, readonly NavKey[]> = {
  owner: ["today", "reports", "menu", "inventory", "finance", "pos", "kds", "orders", "purchasing", "team", "settings"],
  manager: ["today", "pos", "inventory", "menu", "reports", "orders", "kds", "purchasing", "finance", "team", "settings"],
  cashier: ["pos", "orders", "kds"],
  waiter: ["pos", "kds"],
  kitchen: ["kds", "inventory", "menu"],
  stock: ["inventory", "purchasing", "menu"],
  accountant: ["finance", "reports", "purchasing", "inventory"],
};
const DEFAULT_ORDER: readonly NavKey[] = NAV_ITEMS.map((n) => n.key);

export const MAX_PRIMARY_NAV = 5;

export function navigationFor(access: Access, roleKey?: string): { primary: NavItem[]; more: NavItem[] } {
  const order = (roleKey && ROLE_NAV_ORDER[roleKey as RoleKey]) || DEFAULT_ORDER;
  const allowed = NAV_ITEMS.filter((n) => canAny(access, n.anyOf));
  const rank = (k: NavKey) => {
    const i = order.indexOf(k);
    return i === -1 ? 100 + DEFAULT_ORDER.indexOf(k) : i;
  };
  allowed.sort((a, b) => rank(a.key) - rank(b.key));
  return { primary: allowed.slice(0, MAX_PRIMARY_NAV), more: allowed.slice(MAX_PRIMARY_NAV) };
}

export function homeFor(access: Access, preferred?: Home): string {
  const map: Record<Home, NavKey> = {
    today: "today",
    pos: "pos",
    kds: "kds",
    inventory: "inventory",
    finance: "finance",
    reports: "reports",
  };
  const wanted = preferred ? NAV_ITEMS.find((n) => n.key === map[preferred]) : undefined;
  if (wanted && canAny(access, wanted.anyOf)) return wanted.href;
  return navigationFor(access).primary[0]?.href ?? "/no-access";
}

// ---------------------------------------------------------------------------
// Route guard — deep links respect the same permissions as the navigation
// ---------------------------------------------------------------------------
const ROUTE_RULES: readonly { prefix: string; anyOf: readonly Permission[] }[] = [
  { prefix: "/inventory/receive", anyOf: ["inventory.receive"] },
  { prefix: "/inventory/waste", anyOf: ["inventory.waste"] },
  { prefix: "/inventory/count", anyOf: ["inventory.count"] },
  { prefix: "/inventory/new", anyOf: ["inventory.manage"] },
  { prefix: "/menu/new", anyOf: ["menu.manage"] },
  { prefix: "/finance/close", anyOf: ["finance.close_day"] },
  { prefix: "/setup", anyOf: ["settings.manage"] },
  ...NAV_ITEMS.map((n) => ({ prefix: n.href, anyOf: n.anyOf })),
];

/** Whether a signed-in person may open this path. Unknown paths are left to the router (404). */
export function routeAllowed(access: Access, pathname: string): boolean {
  if (pathname === "/no-access") return true;
  const rule = ROUTE_RULES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return !rule || canAny(access, rule.anyOf);
}

// ---------------------------------------------------------------------------
// Quick actions ("ทำอะไรต่อดี") for the Today screen
// ---------------------------------------------------------------------------
export interface QuickAction {
  key: string;
  th: string;
  en: string;
  hint: string;
  href: string;
  icon: string;
  requires: Permission;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { key: "sell", th: "เริ่มขาย", en: "Start selling", hint: "เปิดกะแล้วรับออเดอร์", href: "/pos", icon: "store", requires: "pos.order" },
  { key: "receive", th: "รับของเข้า", en: "Receive goods", hint: "ถ่ายรูปบิล กรอกจำนวน จบ", href: "/inventory/receive", icon: "package-plus", requires: "inventory.receive" },
  { key: "waste", th: "บันทึกของเสีย", en: "Record waste", hint: "ใช้เวลาไม่ถึง 10 วินาที", href: "/inventory/waste", icon: "trash", requires: "inventory.waste" },
  { key: "count", th: "นับสต็อก", en: "Count stock", hint: "นับทีละรายการตามชั้นวาง", href: "/inventory/count", icon: "clipboard-check", requires: "inventory.count" },
  { key: "reorder", th: "สั่งซื้อของ", en: "Reorder", hint: "ระบบคำนวณจำนวนที่ควรสั่งให้", href: "/purchasing", icon: "truck", requires: "purchasing.manage" },
  { key: "close", th: "ปิดยอดวันนี้", en: "Close the day", hint: "ตรวจเงินสด สรุปยอด ส่งบัญชี", href: "/finance/close", icon: "moon", requires: "finance.close_day" },
];

export function quickActionsFor(access: Access): QuickAction[] {
  return QUICK_ACTIONS.filter((a) => can(access, a.requires));
}
