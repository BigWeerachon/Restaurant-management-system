"use client";

import { Calculator, ChefHat, ClipboardList, Crown, PackageCheck, Store, UserRoundCog, Wallet } from "lucide-react";
import { motion } from "motion/react";
import type { Member, Role } from "@/lib/demo/types";

const ROLE_SEES: Record<string, string> = {
  owner: "ภาพรวม · กำไรจริง · ทุกอย่าง",
  manager: "หน้าร้าน · สต็อก · ทีม · ปิดยอด",
  cashier: "ขายหน้าร้าน · บิลวันนี้ · จอครัว",
  waiter: "รับออเดอร์ · ส่งเข้าครัว",
  kitchen: "จอครัว · ของเสีย · สูตรอาหาร",
  stock: "รับของ · นับสต็อก · สั่งซื้อ",
  accountant: "การเงิน · กระทบยอด · รายงาน",
};

// Same colours the Avatar component uses per role, just carried onto a
// rounded-square icon badge instead of a lettered circle — one visual
// language for "what am I clicking" across the whole app (cf. today/page.tsx's
// task grid).
const ROLE_STYLE: Record<string, { icon: typeof Store; badge: string }> = {
  owner: { icon: Crown, badge: "bg-tone-violet text-tone-violet-ink" },
  manager: { icon: UserRoundCog, badge: "bg-tone-indigo text-tone-indigo-ink" },
  cashier: { icon: Wallet, badge: "bg-tone-emerald text-tone-emerald-ink" },
  waiter: { icon: ClipboardList, badge: "bg-tone-sky text-tone-sky-ink" },
  kitchen: { icon: ChefHat, badge: "bg-tone-orange text-tone-orange-ink" },
  stock: { icon: PackageCheck, badge: "bg-tone-amber text-tone-amber-ink" },
  accountant: { icon: Calculator, badge: "bg-tone-rose text-tone-rose-ink" },
};

/** "Who are you today?" — one card per team member, showing what their role gets to see. */
export function RoleCards({ members, roles, onPick }: { members: Member[]; roles: Role[]; onPick: (memberId: string) => void }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {members.map((m, i) => {
        const role = roles.find((r) => r.key === m.roleKey);
        const style = ROLE_STYLE[m.roleKey];
        const RoleIcon = style?.icon ?? Store;
        return (
          <motion.li key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.04 }}>
            <button
              onClick={() => onPick(m.id)}
              className="glass group flex h-full w-full flex-col gap-2.5 rounded-2xl p-4 text-left transition-[box-shadow,transform,border-color,background-color] hover:-translate-y-0.5 hover:border-brand/60 hover:bg-brand-soft/25 hover:shadow-md focus-visible:border-brand/60 focus-visible:bg-brand-soft/25 focus-visible:shadow-md"
            >
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-transform group-hover:scale-105 ${style?.badge ?? "bg-brand-soft text-brand-soft-ink"}`}>
                <RoleIcon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold leading-snug text-ink">{role?.name}</span>
                <span className="block text-[13px] leading-snug text-ink-3">
                  {m.name}
                  {ROLE_SEES[m.roleKey] ? ` · ${ROLE_SEES[m.roleKey]}` : ""}
                </span>
              </span>
            </button>
          </motion.li>
        );
      })}
    </ul>
  );
}
