/**
 * "เริ่มต้นใช้งาน" — the first-run checklist.
 *
 * Progress is derived from real data (app.v_onboarding_facts), never from
 * ticked boxes: the moment the first ingredient exists, that step is done,
 * wherever it was created. Optional steps can be skipped; required ones can't.
 */
export interface OnboardingFacts {
  branchReady: boolean;
  paymentsReady: boolean;
  ingredients: number;
  menuItems: number;
  recipes: number;
  staff: number;
  hasSale: boolean;
  skipped: readonly string[];
}

export type StepKey = "branch" | "payments" | "ingredient" | "menu" | "recipe" | "staff" | "first_sale";

export interface StepDef {
  key: StepKey;
  title: string;
  titleEn: string;
  why: string;
  cta: string;
  href: string;
  minutes: number;
  optional: boolean;
  done: (f: OnboardingFacts) => boolean;
}

export const ONBOARDING_STEPS: readonly StepDef[] = [
  {
    key: "branch",
    title: "ตั้งค่าสาขาแรก",
    titleEn: "Set up your first branch",
    why: "ที่อยู่และเวลาเปิด-ปิดจะไปอยู่บนใบเสร็จ และใช้ตัดยอดขายเป็นรายวัน",
    cta: "ตั้งค่าสาขา",
    href: "/setup/branch",
    minutes: 1,
    optional: false,
    done: (f) => f.branchReady,
  },
  {
    key: "payments",
    title: "เลือกช่องทางรับเงิน",
    titleEn: "Choose how you get paid",
    why: "เปิดพร้อมเพย์หรือบัตร แล้วระบบจะสร้าง QR ตามยอดบิลและกระทบยอดให้อัตโนมัติ",
    cta: "ตั้งค่าการรับเงิน",
    href: "/setup/payments",
    minutes: 2,
    optional: false,
    done: (f) => f.paymentsReady,
  },
  {
    key: "ingredient",
    title: "เพิ่มวัตถุดิบแรก",
    titleEn: "Add your first ingredient",
    why: "เริ่มจากของที่ใช้บ่อยที่สุด 5 อย่างก็พอ ที่เหลือค่อยเพิ่มตอนรับของเข้า",
    cta: "เพิ่มวัตถุดิบ",
    href: "/inventory/new",
    minutes: 2,
    optional: false,
    done: (f) => f.ingredients > 0,
  },
  {
    key: "menu",
    title: "เพิ่มเมนูแรก",
    titleEn: "Add your first menu item",
    why: "ชื่อ ราคา และรูป — แค่นี้ก็เริ่มขายได้แล้ว",
    cta: "เพิ่มเมนู",
    href: "/menu/new",
    minutes: 2,
    optional: false,
    done: (f) => f.menuItems > 0,
  },
  {
    key: "recipe",
    title: "ใส่สูตรให้เมนูขายดี",
    titleEn: "Add a recipe to a best-seller",
    why: "ระบบจะตัดสต็อกให้เองทุกครั้งที่ขาย และบอกต้นทุน-กำไรต่อจานทันที",
    cta: "ใส่สูตร",
    href: "/menu",
    minutes: 3,
    optional: true,
    done: (f) => f.recipes > 0,
  },
  {
    key: "staff",
    title: "เชิญพนักงาน",
    titleEn: "Invite your team",
    why: "พนักงานใช้แค่ PIN 4 หลักบนเครื่องร้าน ไม่ต้องมีอีเมล และเห็นเฉพาะงานของตัวเอง",
    cta: "เพิ่มพนักงาน",
    href: "/team",
    minutes: 2,
    optional: true,
    done: (f) => f.staff > 1,
  },
  {
    key: "first_sale",
    title: "ขายบิลแรก",
    titleEn: "Make your first sale",
    why: "ลองขาย 1 บิล ดูออเดอร์เด้งขึ้นจอครัว แล้วดูสต็อกถูกตัดอัตโนมัติ",
    cta: "ไปหน้าขาย",
    href: "/pos",
    minutes: 1,
    optional: false,
    done: (f) => f.hasSale,
  },
];

export interface StepState extends Omit<StepDef, "done"> {
  status: "done" | "skipped" | "todo";
}

export interface OnboardingProgress {
  steps: StepState[];
  completed: number;
  total: number;
  /** 0–100, skipped optional steps count as resolved. */
  percent: number;
  next: StepState | null;
  isComplete: boolean;
  minutesLeft: number;
}

export function onboardingProgress(facts: OnboardingFacts): OnboardingProgress {
  const steps: StepState[] = ONBOARDING_STEPS.map(({ done, ...def }) => ({
    ...def,
    status: done(facts) ? "done" : def.optional && facts.skipped.includes(def.key) ? "skipped" : "todo",
  }));
  const resolved = steps.filter((s) => s.status !== "todo");
  const next = steps.find((s) => s.status === "todo") ?? null;
  return {
    steps,
    completed: steps.filter((s) => s.status === "done").length,
    total: steps.length,
    percent: Math.round((resolved.length / steps.length) * 100),
    next,
    isComplete: next === null,
    minutesLeft: steps.filter((s) => s.status === "todo").reduce((m, s) => m + s.minutes, 0),
  };
}

export function canSkip(key: StepKey): boolean {
  return ONBOARDING_STEPS.find((s) => s.key === key)?.optional ?? false;
}
